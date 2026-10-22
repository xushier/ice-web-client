import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { Manager } from '../core/manager';
import { encodeFrame, parseHex, toHexUpper } from '../protocol/frame';
import type { ModuleConfig, ServerConfig } from '../core/types';

const VERSION = '0.1.0';
const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const WEB_DIR = path.resolve(process.env.WEB_DIR ?? 'dist/web');

const clients = new Set<WebSocket>();
const manager = new Manager(DATA_DIR, (evt) => {
  const payload = JSON.stringify(evt);
  for (const client of clients) {
    if (client.readyState === 1) client.send(payload);
  }
});

const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

function stripRuntime(m: ModuleConfig): ModuleConfig {
  return {
    id: m.id,
    towerName: m.towerName,
    moduleId: m.moduleId,
    phaseCount: m.phaseCount,
    devices: m.devices,
    states: m.states,
    telemetry: m.telemetry,
    autoMode: m.autoMode,
    autoConnect: m.autoConnect,
  };
}

async function main(): Promise<void> {
  await app.register(websocket);

  if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
    await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/' });
  } else {
    console.warn(`[web] 未找到前端构建产物：${WEB_DIR}（开发模式请使用 vite）`);
  }

  app.get('/api/health', async () => ({ ok: true, version: VERSION, uptime: process.uptime() }));

  app.get('/ws', { websocket: true }, (rawSocket) => {
    const socket = (rawSocket as unknown as { socket?: WebSocket }).socket ?? (rawSocket as unknown as WebSocket);
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'state', state: manager.getState() }));
    socket.send(JSON.stringify({ type: 'frames', frames: manager.getFrames(undefined, 200) }));
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  app.get('/api/state', async () => manager.getState());

  app.get('/api/frames', async (req) => {
    const q = req.query as { moduleId?: string; limit?: string };
    return manager.getFrames(q.moduleId, Number(q.limit ?? 200));
  });

  app.put('/api/server', async (req) => {
    const body = req.body as Partial<ServerConfig>;
    return manager.updateServer(body);
  });

  app.post('/api/modules', async (req, reply) => {
    const body = req.body as Parameters<Manager['createModule']>[0];
    if (body?.moduleId === undefined || Number.isNaN(Number(body.moduleId))) {
      return reply.code(400).send({ error: 'moduleId 必填，且必须是 0~4095 的数字' });
    }
    return manager.createModule(body);
  });

  app.patch('/api/modules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = manager.updateModule(id, req.body as Partial<ModuleConfig>);
    if (!result) return reply.code(404).send({ error: '模块不存在' });
    return result;
  });

  app.delete('/api/modules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!manager.deleteModule(id)) return reply.code(404).send({ error: '模块不存在' });
    return { ok: true };
  });

  for (const action of ['connect', 'disconnect', 'reconnect'] as const) {
    app.post(`/api/modules/:id/${action}`, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!manager.getModule(id)) return reply.code(404).send({ error: '模块不存在' });
      manager[action](id);
      return { ok: true };
    });
  }

  app.post('/api/modules/:id/devices/:key', async (req, reply) => {
    const { id, key } = req.params as { id: string; key: string };
    const { state } = req.body as { state: string };
    if (!state) return reply.code(400).send({ error: 'state 必填' });
    manager.setDevice(id, key, state);
    return { ok: true };
  });

  app.post('/api/modules/:id/pending/:pendingId', async (req) => {
    const { id, pendingId } = req.params as { id: string; pendingId: string };
    const { action } = req.body as { action: 'confirm' | 'dismiss' };
    if (action === 'dismiss') manager.dismissPending(id, pendingId);
    else manager.applyPending(id, pendingId);
    return { ok: true };
  });

  app.post('/api/modules/:id/telemetry', async (req) => {
    const { id } = req.params as { id: string };
    manager.setTelemetry(id, req.body as Partial<ModuleConfig['telemetry']>);
    return { ok: true };
  });

  app.post('/api/modules/:id/preset', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { preset } = req.body as { preset: 'initial' | 'melt' };
    if (preset !== 'initial' && preset !== 'melt') return reply.code(400).send({ error: 'preset 必须是 initial 或 melt' });
    manager.setPreset(id, preset);
    return { ok: true };
  });

  app.post('/api/modules/:id/report', async (req) => {
    const { id } = req.params as { id: string };
    const { includePower } = (req.body ?? {}) as { includePower?: boolean };
    manager.report(id, includePower);
    return { ok: true };
  });

  app.post('/api/modules/:id/send', async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = manager.getModule(id);
    if (!snapshot) return reply.code(404).send({ error: '模块不存在' });
    const body = req.body as {
      hex?: string;
      type?: number;
      dataHex?: string;
      moduleId?: number;
      crcMode?: 'auto' | 'zero';
    };
    try {
      let bytes: Uint8Array;
      if (body.hex) {
        bytes = parseHex(body.hex);
        if (bytes.length < 8) return reply.code(400).send({ error: '帧至少 8 字节' });
      } else if (typeof body.type === 'number') {
        bytes = encodeFrame({
          id: body.moduleId ?? snapshot.moduleId,
          type: body.type,
          data: parseHex(body.dataHex ?? ''),
          crcMode: body.crcMode ?? manager.server.crcMode,
        });
      } else {
        return reply.code(400).send({ error: '请提供 hex 或 type' });
      }
      manager.sendRaw(id, bytes);
      return { ok: true, hex: toHexUpper(bytes) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/config/export', async (_req, reply) => {
    reply.header('content-disposition', 'attachment; filename="ice-web-client-config.json"');
    return {
      version: 1,
      server: manager.server,
      modules: manager.getState().modules.map(stripRuntime),
    };
  });

  app.post('/api/config/import', async (req, reply) => {
    const body = req.body as { server?: ServerConfig; modules?: ModuleConfig[] };
    if (!body?.modules || !Array.isArray(body.modules)) {
      return reply.code(400).send({ error: 'modules 必须是数组' });
    }
    for (const mod of manager.getState().modules) manager.deleteModule(mod.id);
    if (body.server) manager.updateServer(body.server);
    for (const mod of body.modules) {
      manager.createModule({
        towerName: mod.towerName,
        moduleId: mod.moduleId,
        phaseCount: mod.phaseCount,
        devices: mod.devices,
        states: mod.states,
        telemetry: mod.telemetry,
        autoConnect: false,
      });
    }
    return { ok: true, count: body.modules.length };
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/ws')) {
      return reply.code(404).send({ error: '接口不存在' });
    }
    const indexFile = path.join(WEB_DIR, 'index.html');
    if (fs.existsSync(indexFile)) {
      return reply.type('text/html').send(fs.readFileSync(indexFile));
    }
    return reply.code(404).type('text/plain').send('前端未构建，请执行 npm run build:web');
  });

  manager.init();

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[ice-web-client] v${VERSION} listening on :${PORT}  data=${DATA_DIR}  web=${WEB_DIR}`);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    manager.saveNow();
    app.close().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});
