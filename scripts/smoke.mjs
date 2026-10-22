#!/usr/bin/env node
/**
 * 端到端冒烟测试：内置假平台 + 真实服务进程。
 *   node scripts/smoke.mjs        （需先 npm run build）
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, '_tmp', 'smoke-data');
const APP_PORT = 18080;
const PLATFORM_PORT = 14000;
const MODULE_ID = 13;

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const log = (...a) => console.log('[smoke]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}
function build(id, type, data = []) {
  const buf = Buffer.alloc(8 + data.length);
  buf[0] = 0x5a;
  buf[1] = 0x47;
  buf[2] = 3 + data.length;
  buf.writeUInt16BE(id, 3);
  buf[5] = type;
  Buffer.from(data).copy(buf, 6);
  const crc = crc16(buf.subarray(0, 6 + data.length));
  buf[6 + data.length] = crc & 0xff;
  buf[7 + data.length] = (crc >> 8) & 0xff;
  return buf;
}

const received = [];
let terminal = null;

const platform = net.createServer((sock) => {
  terminal = sock;
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const idx = buf.indexOf(Buffer.from([0x5a, 0x47]));
      if (idx < 0) break;
      buf = buf.subarray(idx);
      if (buf.length < 3) break;
      const total = 3 + buf[2] + 2;
      if (buf.length < total) break;
      const raw = buf.subarray(0, total);
      buf = buf.subarray(total);
      const frame = {
        id: raw.readUInt16BE(3),
        type: raw[5],
        data: [...raw.subarray(6, 6 + raw[2] - 3)],
        raw: [...raw],
      };
      received.push(frame);
      // 平台行为：收到任何帧回心跳
      sock.write(build(frame.id, 0x11, [0x00]));
    }
  });
  sock.on('error', () => {});
});

const app = spawn(process.execPath, [path.join('dist', 'server.cjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(APP_PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.on('data', (d) => process.stdout.write(`  [app] ${d}`));
app.stderr.on('data', (d) => process.stderr.write(`  [app:err] ${d}`));

const base = `http://127.0.0.1:${APP_PORT}`;
async function req(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function assert(cond, message) {
  if (!cond) throw new Error(`断言失败：${message}`);
}

async function main() {
  await new Promise((r) => platform.listen(PLATFORM_PORT, '127.0.0.1', r));
  log('假平台已启动 :' + PLATFORM_PORT);

  for (let i = 0; i < 50; i++) {
    try {
      await req('GET', '/api/health');
      break;
    } catch {
      await sleep(150);
    }
  }
  log('服务已启动 :' + APP_PORT);

  await req('PUT', '/api/server', { host: '127.0.0.1', port: PLATFORM_PORT, statusIntervalSec: 60 });
  const mod = await req('POST', '/api/modules', {
    towerName: '冒烟测试塔',
    moduleId: MODULE_ID,
    phaseCount: 2,
  });
  await req('POST', `/api/modules/${mod.id}/connect`);
  await sleep(600);

  assert(terminal, '终端应已连上假平台');
  assert(
    received.some((f) => f.type === 0x05),
    '连接后应发送 0x05 上线帧',
  );
  const firstDi = received.find((f) => f.type === 0x10);
  assert(firstDi, '连接后应发送 0x10 状态帧');
  assert(firstDi.data[0] & 0x01, '默认状态：接地刀闸应为合闸位');
  assert(firstDi.data[0] & 0x04, '默认状态：融冰锁应为闭锁位');
  assert(received.some((f) => f.type === 0x20), '连接后应发送 0x20 供电帧');

  // 平台下发「接地刀闸分闸」
  terminal.write(build(MODULE_ID, 0x00, [0x00, 0x40]));
  await sleep(400);
  let state = await req('GET', '/api/state');
  const pending = state.modules[0].pending;
  assert(pending.length === 1 && pending[0].key === 'ground', '应产生接地刀闸待动作');
  assert(
    received.some((f) => f.type === 0x01),
    '收到 0x00 后应回 0x01 ACK',
  );

  // 人工点「分闸到位」
  await req('POST', `/api/modules/${mod.id}/devices/ground`, { state: 'open' });
  await sleep(400);
  const lastDi = [...received].reverse().find((f) => f.type === 0x10);
  assert(lastDi.data[1] & 0x80, '接地刀闸分闸应置 Byte1 b7');
  assert(!(lastDi.data[0] & 0x01), '接地刀闸分闸应清除 Byte0 b0');

  // 自动模式：延时 0，平台发「融冰刀闸合闸」（命令帧 Byte0 b3 = 0x08，注意与状态帧 b4 不同）
  await req('PUT', '/api/server', { autoModeDefault: true, autoDelaySec: 0 });
  terminal.write(build(MODULE_ID, 0x00, [0x08, 0x00]));
  await sleep(700);
  state = await req('GET', '/api/state');
  assert(state.modules[0].states.ice === 'closed', '自动模式应把融冰刀闸置为合闸到位');
  const autoDi = [...received].reverse().find((f) => f.type === 0x10);
  assert(autoDi.data[0] & 0x10, '融冰刀闸合闸应置 Byte0 b4');

  // 未知帧不应崩
  terminal.write(build(MODULE_ID, 0x77, [0xde, 0xad]));
  await sleep(300);
  const frames = await req('GET', '/api/frames?limit=50');
  assert(
    frames.some((f) => f.parsed.type === 0x77 && !f.parsed.known),
    '未知帧应被记录并标记为未定义',
  );
  assert(
    frames.some((f) => f.parsed.type === 0x10 && f.parsed.summary.includes('DI 状态')),
    '0x10 帧应有语义解析',
  );

  log('✓ 全部断言通过');
  log(`  收发帧统计：${received.length} 条上行帧`);
}

main()
  .then(() => {
    app.kill();
    platform.close();
    setTimeout(() => process.exit(0), 200);
  })
  .catch((err) => {
    console.error('[smoke] ✗', err.message);
    app.kill();
    platform.close();
    setTimeout(() => process.exit(1), 200);
  });
