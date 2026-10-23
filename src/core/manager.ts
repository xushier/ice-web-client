import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModuleSession, type SessionDeps } from './session';
import {
  DEFAULT_SERVER,
  deviceMeta,
  orderDevices,
  presetStates,
  randomTelemetry,
  type AppState,
  type FrameEntry,
  type ModuleConfig,
  type ModuleSnapshot,
  type ServerConfig,
} from './types';
import { defaultStates, getProfile, type ProtocolId } from '../protocol/bits';

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
    protocol?: ProtocolId;
    towerName?: string;
    moduleId: number;
    phaseCount?: number;
    devices?: string[];
    states?: Record<string, string>;
    telemetry?: ModuleConfig['telemetry'];
    autoConnect?: boolean;
  }): ModuleSnapshot {
    const moduleId = clamp(Number(input.moduleId), 0, 4095);
    this.assertModuleIdFree(moduleId, null);
    const protocol: ProtocolId = input.protocol === 'mg500' ? 'mg500' : 'mg400';
    const requestedPhaseCount = clamp(Number(input.phaseCount ?? 2), 0, 4);
    const allowed = new Set(getProfile(protocol).devices);
    const devices = (
      input.devices?.length ? [...input.devices] : orderDevices(defaultDevices(protocol, requestedPhaseCount))
    ).filter((key) => allowed.has(key));
    if (!devices.length) devices.push(...orderDevices(defaultDevices(protocol, requestedPhaseCount)));
    const phaseCount = countPhases(devices);
    const cfg: ModuleConfig = normalizeModule({
      id: randomUUID(),
      protocol,
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
    this.log(
      cfg.id,
      `新建模块 #${cfg.moduleId}（${protocol.toUpperCase()}：${devices.map((k) => deviceMeta(k).name).join('、')}）`,
    );
    this.saveNow();
    this.scheduleBroadcast();
    if (cfg.autoConnect) session.connect();
    return session.snapshot();
  }

  updateModule(id: string, patch: Partial<ModuleConfig>): ModuleSnapshot | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (patch.moduleId !== undefined) this.assertModuleIdFree(clamp(Number(patch.moduleId), 0, 4095), id);
    const next: ModuleConfig = {
      ...session.cfg,
      ...patch,
      id: session.cfg.id,
      states: { ...session.cfg.states, ...(patch.states ?? {}) },
      telemetry: { ...session.cfg.telemetry, ...(patch.telemetry ?? {}) },
    };
    next.moduleId = clamp(Number(next.moduleId), 0, 4095);
    next.protocol = next.protocol === 'mg500' ? 'mg500' : 'mg400';
    next.towerName = (next.towerName ?? '').trim() || `铁塔 ${next.moduleId}`;

    // 按协议过滤设备：切到 MG400 时不能保留接地刀闸 2 / 选相 3 / 活化
    const profile = getProfile(next.protocol);
    const allowed = new Set(profile.devices);
    const filtered = [...new Set(next.devices.filter((key) => allowed.has(key)))];
    if (filtered.length === 0) filtered.push(...defaultDevices(next.protocol, Math.min(2, profile.maxPhases)));
    // 保留用户自定义顺序（拖动 / 对话框里的上下移动），不要重新排序
    next.devices = filtered;
    next.phaseCount = countPhases(next.devices);

    const defaults = defaultStates(next.phaseCount);
    for (const key of next.devices) {
      if (!next.states[key]) next.states[key] = defaults[key] ?? 'closed';
    }
    // 删掉已不在设备清单里的状态，避免切换协议后残留
    for (const key of Object.keys(next.states)) {
      if (!next.devices.includes(key)) delete next.states[key];
    }

    const changedId = next.moduleId !== session.cfg.moduleId;
    session.cfg = next;
    this.saveDebounced();
    this.scheduleBroadcast();
    this.log(id, `修改模块信息：#${next.moduleId} ${next.towerName}（${next.protocol.toUpperCase()}）`);
    if (changedId && session.link === 'online') {
      this.log(id, '模块 ID 已变更，建议重连一次让平台重新绑定');
    }
    return session.snapshot();
  }

  private assertModuleIdFree(moduleId: number, selfId: string | null): void {
    for (const [id, session] of this.sessions) {
      if (id !== selfId && session.cfg.moduleId === moduleId) {
        throw new Error(`模块 ID ${moduleId} 已被「${session.cfg.towerName}」占用`);
      }
    }
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
    session.applyPreset(presetStates(session.cfg.devices, preset));
    this.log(id, `一键${preset === 'initial' ? '初始态' : '融冰态'}`);
    this.saveDebounced();
  }

  report(id: string, includePower = false, includeEnv = false): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.sendStatus();
    if (includePower) session.sendPower();
    if (includeEnv) session.sendEnv();
  }

  /** 历史整包：0x10 + 0x20 + 0x30 */
  reportHistory(id: string): void {
    this.sessions.get(id)?.reportHistory('manual');
  }

  sendRaw(id: string, bytes: Uint8Array): void {
    this.sessions.get(id)?.sendRaw(bytes);
  }

  updateServer(patch: Partial<ServerConfig>): ServerConfig {
    this.server = { ...this.server, ...patch };
    this.server.port = clamp(Number(this.server.port), 1, 65535);
    this.server.statusIntervalSec = clamp(Number(this.server.statusIntervalSec), 5, 3600);
    this.server.powerIntervalSec = clamp(Number(this.server.powerIntervalSec), 30, 86400);
    this.server.envIntervalSec = clamp(Number(this.server.envIntervalSec), 120, 3600);
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

function defaultDevices(protocol: ProtocolId, phaseCount: number): string[] {
  const devices = protocol === 'mg500' ? ['ground', 'ground2', 'ice', 'lock'] : ['ground', 'ice', 'lock'];
  for (let i = 1; i <= phaseCount; i++) devices.push(`phase${i}`);
  return devices;
}

function countPhases(devices: string[]): number {
  return devices.filter((k) => /^phase\d+$/.test(k)).length;
}

function normalizeModule(cfg: ModuleConfig): ModuleConfig {
  const protocol: ProtocolId = cfg.protocol === 'mg500' ? 'mg500' : 'mg400';
  const phaseCount = clamp(Number(cfg.phaseCount ?? 2), 0, 4);
  const devices = cfg.devices?.length ? cfg.devices : defaultDevices(protocol, phaseCount);
  const defaults = defaultStates(phaseCount);
  const states: Record<string, string> = {};
  for (const key of devices) states[key] = cfg.states?.[key] ?? defaults[key] ?? 'closed';
  return {
    id: cfg.id ?? randomUUID(),
    protocol,
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
