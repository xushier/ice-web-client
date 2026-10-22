import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModuleSession, type SessionDeps } from './session';
import {
  DEFAULT_SERVER,
  INITIAL_STATE,
  MELT_STATE,
  deviceMeta,
  orderDevices,
  randomTelemetry,
  type AppState,
  type FrameEntry,
  type ModuleConfig,
  type ModuleSnapshot,
  type ServerConfig,
} from './types';
import { defaultStates } from '../protocol/bits';

interface PersistShape {
  version: number;
  server: ServerConfig;
  modules: ModuleConfig[];
}

const FRAME_BUFFER = 400;

export class Manager {
  server: ServerConfig = { ...DEFAULT_SERVER };
  startedAt = Date.now();

  private sessions = new Map<string, ModuleSession>();
  private frames = new Map<string, FrameEntry[]>();
  private seq = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private deps: SessionDeps;

  constructor(private dataDir: string, private broadcast: (evt: unknown) => void) {
    this.deps = {
      server: () => this.server,
      onFrame: (entry) => this.pushFrame(entry),
      onChange: () => this.scheduleBroadcast(),
      log: (moduleId, text) => this.log(moduleId, text),
      autoEnabled: (cfg) =>
        cfg.autoMode === 'on' || (cfg.autoMode === 'inherit' && this.server.autoModeDefault),
    };
  }

  init(): void {
    fs.mkdirSync(path.join(this.dataDir, 'logs'), { recursive: true });
    const file = path.join(this.dataDir, 'config.json');
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PersistShape>;
        this.server = { ...DEFAULT_SERVER, ...(raw.server ?? {}) };
        for (const cfg of raw.modules ?? []) {
          const normalized = normalizeModule(cfg);
          this.sessions.set(normalized.id, new ModuleSession(normalized, this.deps));
        }
      } catch (err) {
        console.error('[config] 读取失败，使用默认配置：', (err as Error).message);
      }
    }
    this.log(null, `服务启动，加载 ${this.sessions.size} 个模块`);
    for (const session of this.sessions.values()) {
      if (session.cfg.autoConnect) setTimeout(() => session.connect(), 400);
    }
  }

  /* ------------------------------------------------------------- 状态 */

  getState(): AppState {
    return {
      server: this.server,
      modules: [...this.sessions.values()].map((s) => s.snapshot()),
      startedAt: this.startedAt,
    };
  }

  getFrames(moduleId?: string, limit = 200): FrameEntry[] {
    const all: FrameEntry[] = [];
    if (moduleId) {
      all.push(...(this.frames.get(moduleId) ?? []));
    } else {
      for (const list of this.frames.values()) all.push(...list);
      all.sort((a, b) => a.seq - b.seq);
    }
    return all.slice(-limit);
  }

  getModule(id: string): ModuleSnapshot | null {
    return this.sessions.get(id)?.snapshot() ?? null;
  }

  /* ------------------------------------------------------------- 模块增删改 */

  createModule(input: {
    towerName?: string;
    moduleId: number;
    phaseCount?: number;
    devices?: string[];
    states?: Record<string, string>;
    telemetry?: ModuleConfig['telemetry'];
    autoConnect?: boolean;
  }): ModuleSnapshot {
    const moduleId = clamp(Number(input.moduleId), 0, 4095);
    const requestedPhaseCount = clamp(Number(input.phaseCount ?? 2), 0, 4);
    const devices = input.devices?.length
      ? [...input.devices]
      : orderDevices(defaultDevices(requestedPhaseCount));
    const phaseCount = countPhases(devices);
    const cfg: ModuleConfig = normalizeModule({
      id: randomUUID(),
      towerName: (input.towerName ?? '').trim() || `铁塔 ${moduleId}`,
      moduleId,
      phaseCount,
      devices,
      states: { ...defaultStates(phaseCount), ...(input.states ?? {}) },
      telemetry: input.telemetry ?? randomTelemetry(),
      autoMode: 'inherit',
      autoConnect: input.autoConnect ?? false,
    });
    const session = new ModuleSession(cfg, this.deps);
    this.sessions.set(cfg.id, session);
    this.frames.set(cfg.id, []);
    this.log(cfg.id, `新建模块 #${cfg.moduleId}（${devices.map((k) => deviceMeta(k).name).join('、')}）`);
    this.saveNow();
    this.scheduleBroadcast();
    if (cfg.autoConnect) session.connect();
    return session.snapshot();
  }

  updateModule(id: string, patch: Partial<ModuleConfig>): ModuleSnapshot | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const next: ModuleConfig = {
      ...session.cfg,
      ...patch,
      id: session.cfg.id,
      states: { ...session.cfg.states, ...(patch.states ?? {}) },
      telemetry: { ...session.cfg.telemetry, ...(patch.telemetry ?? {}) },
    };
    next.moduleId = clamp(Number(next.moduleId), 0, 4095);
    if (patch.devices) {
      next.phaseCount = countPhases(next.devices);
      // 补齐新增设备的默认状态
      const defaults = defaultStates(next.phaseCount);
      for (const key of next.devices) {
        if (!next.states[key]) next.states[key] = defaults[key] ?? 'closed';
      }
    } else {
      next.phaseCount = clamp(Number(next.phaseCount), 0, 4);
    }
    session.cfg = next;
    this.saveDebounced();
    this.scheduleBroadcast();
    return session.snapshot();
  }

  deleteModule(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.dispose();
    this.sessions.delete(id);
    this.frames.delete(id);
    this.log(null, `删除模块 ${id}`);
    this.saveNow();
    this.scheduleBroadcast();
    return true;
  }

  /* ------------------------------------------------------------- 连接与动作 */

  connect(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.cfg.autoConnect = true;
    this.saveDebounced();
    session.connect();
  }

  disconnect(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.cfg.autoConnect = false;
    this.saveDebounced();
    session.disconnect();
  }

  reconnect(id: string): void {
    this.sessions.get(id)?.reconnect();
  }

  connectAll(): void {
    for (const s of this.sessions.values()) {
      s.cfg.autoConnect = true;
      if (s.link !== 'online') s.connect();
    }
    this.saveDebounced();
  }

  disconnectAll(): void {
    for (const s of this.sessions.values()) {
      s.cfg.autoConnect = false;
      s.disconnect();
    }
    this.saveDebounced();
  }

  setDevice(id: string, key: string, state: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.setDevice(key, state);
    this.log(id, `${deviceMeta(key).name} 手动置为 ${state}`);
    this.saveDebounced();
  }

  applyPending(id: string, pendingId: string): void {
    this.sessions.get(id)?.applyPending(pendingId, 'user');
    this.saveDebounced();
  }

  dismissPending(id: string, pendingId: string): void {
    this.sessions.get(id)?.dismissPending(pendingId);
  }

  setTelemetry(id: string, patch: Partial<ModuleConfig['telemetry']>): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.setTelemetry(patch);
    this.saveDebounced();
  }

  setPreset(id: string, preset: 'initial' | 'melt'): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.applyPreset(preset === 'initial' ? INITIAL_STATE : MELT_STATE);
    this.log(id, `一键${preset === 'initial' ? '初始态' : '融冰态'}`);
    this.saveDebounced();
  }

  report(id: string, includePower = false): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.sendStatus();
    if (includePower) session.sendPower();
  }

  sendRaw(id: string, bytes: Uint8Array): void {
    this.sessions.get(id)?.sendRaw(bytes);
  }

  updateServer(patch: Partial<ServerConfig>): ServerConfig {
    this.server = { ...this.server, ...patch };
    this.server.port = clamp(Number(this.server.port), 1, 65535);
    for (const s of this.sessions.values()) s.applyServerConfig();
    this.log(null, `服务器参数更新：${this.server.host}:${this.server.port}`);
    this.saveDebounced();
    this.scheduleBroadcast();
    return this.server;
  }

  /* ------------------------------------------------------------- 日志 */

  log(moduleId: string | null, text: string): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), moduleId, text });
    try {
      const day = new Date().toISOString().slice(0, 10);
      fs.appendFile(path.join(this.dataDir, 'logs', `ops-${day}.ndjson`), line + '\n', () => {});
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  private pushFrame(entry: Omit<FrameEntry, 'seq'>): void {
    this.seq += 1;
    const frame: FrameEntry = { ...entry, seq: this.seq };
    const list = this.frames.get(entry.moduleId) ?? [];
    list.push(frame);
    if (list.length > FRAME_BUFFER) list.splice(0, list.length - FRAME_BUFFER);
    this.frames.set(entry.moduleId, list);
    this.broadcast({ type: 'frame', frame });
  }

  /* ------------------------------------------------------------- 持久化 */

  private buildPersist(): PersistShape {
    return {
      version: 1,
      server: this.server,
      modules: [...this.sessions.values()].map((s) => s.cfg),
    };
  }

  saveDebounced(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 400);
  }

  saveNow(): void {
    const file = path.join(this.dataDir, 'config.json');
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.buildPersist(), null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[config] 保存失败：', (err as Error).message);
    }
  }

  scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.broadcast({ type: 'state', state: this.getState() });
    }, 60);
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function defaultDevices(phaseCount: number): string[] {
  const devices = ['ground', 'ice', 'lock'];
  for (let i = 1; i <= phaseCount; i++) devices.push(`phase${i}`);
  devices.push('activation');
  return devices;
}

function countPhases(devices: string[]): number {
  return devices.filter((k) => /^phase\d+$/.test(k)).length;
}

function normalizeModule(cfg: ModuleConfig): ModuleConfig {
  const phaseCount = clamp(Number(cfg.phaseCount ?? 2), 0, 4);
  const devices = cfg.devices?.length ? cfg.devices : defaultDevices(phaseCount);
  const defaults = defaultStates(phaseCount);
  const states: Record<string, string> = {};
  for (const key of devices) states[key] = cfg.states?.[key] ?? defaults[key] ?? 'closed';
  return {
    id: cfg.id ?? randomUUID(),
    towerName: cfg.towerName ?? '',
    moduleId: clamp(Number(cfg.moduleId ?? 0), 0, 4095),
    phaseCount,
    devices,
    states,
    telemetry: { ...randomTelemetry(), ...(cfg.telemetry ?? {}) },
    autoMode: cfg.autoMode ?? 'inherit',
    autoConnect: cfg.autoConnect ?? false,
  };
}
