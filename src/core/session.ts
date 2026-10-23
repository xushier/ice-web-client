import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { FrameDecoder, FT, decodeFrame, encodeFrame } from '../protocol/frame';
import { describe } from '../protocol/describe';
import { decodeCommand, getProfile, type DeviceState } from '../protocol/bits';
import { encodeEnv, encodePower } from '../protocol/power';
import type { FrameEntry, LinkState, ModuleConfig, ModuleSnapshot, PendingAction, ServerConfig } from './types';
import { deviceMeta } from './types';

export interface SessionDeps {
  server(): ServerConfig;
  onFrame(entry: Omit<FrameEntry, 'seq'>): void;
  onChange(): void;
  log(moduleId: string, text: string): void;
  autoEnabled(cfg: ModuleConfig): boolean;
}

const TARGET_OF_KIND: Record<string, string> = {
  close: 'closed',
  open: 'open',
  lock: 'locked',
  unlock: 'unlocked',
  on: 'on',
  off: 'off',
};

const ENV_KEYS: Array<keyof ModuleConfig['telemetry']> = [
  'envTemp',
  'envHumidity',
  'cell1Temp',
  'cell2Temp',
  'acState',
  'fireUsed',
];

export class ModuleSession {
  cfg: ModuleConfig;
  link: LinkState = 'idle';
  error: string | null = null;
  lastRx: number | null = null;
  lastTx: number | null = null;
  lastCommandAt: number | null = null;
  attempts = 0;
  rxCount = 0;
  txCount = 0;
  pending: PendingAction[] = [];
  lastHistoryAt: number | null = null;
  lastPowerAck: number | null = null;
  lastEnvAck: number | null = null;
  lastTxType: number | null = null;

  private sock: net.Socket | null = null;
  private decoder = new FrameDecoder();
  private statusTimer: NodeJS.Timeout | null = null;
  private powerTimer: NodeJS.Timeout | null = null;
  private envTimer: NodeJS.Timeout | null = null;
  private bundleTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private envReportTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private connectedAt = 0;
  private autoTimers = new Map<string, NodeJS.Timeout>();
  private closedByUser = false;

  constructor(cfg: ModuleConfig, private deps: SessionDeps) {
    this.cfg = cfg;
  }

  snapshot(): ModuleSnapshot {
    return {
      ...this.cfg,
      link: this.link,
      lastRx: this.lastRx,
      lastTx: this.lastTx,
      attempts: this.attempts,
      error: this.error,
      pending: this.pending,
      rxCount: this.rxCount,
      txCount: this.txCount,
      lastCommandAt: this.lastCommandAt,
      lastHistoryAt: this.lastHistoryAt,
      lastPowerAck: this.lastPowerAck,
      lastEnvAck: this.lastEnvAck,
    };
  }

  /* ------------------------------------------------------------- 连接管理 */

  connect(): void {
    const srv = this.deps.server();
    if (!srv.host) {
      this.error = '未配置服务器地址';
      this.link = 'offline';
      this.notify();
      return;
    }
    this.teardownSocket();
    this.closedByUser = false;
    this.link = 'connecting';
    this.error = null;
    this.notify();

    const sock = net.createConnection({ host: srv.host, port: srv.port });
    this.sock = sock;
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 15000);

    this.connectTimer = setTimeout(() => {
      if (this.link === 'connecting') {
        this.error = `连接超时（${srv.connectTimeoutMs}ms）`;
        sock.destroy();
      }
    }, srv.connectTimeoutMs);

    sock.once('connect', () => this.onConnect());
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('error', (err) => {
      this.error = err.message;
      this.deps.log(this.cfg.id, `连接错误：${err.message}`);
    });
    sock.on('close', () => this.onClose());
  }

  disconnect(): void {
    this.closedByUser = true;
    this.teardownSocket();
    this.link = 'idle';
    this.pending = [];
    this.notify();
  }

  reconnect(): void {
    this.attempts = 0;
    this.connect();
  }

  /** 服务器参数变更后重启周期定时器 */
  applyServerConfig(): void {
    if (this.link === 'online') this.startTimers();
  }

  private onConnect(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.link = 'online';
    this.error = null;
    this.decoder = new FrameDecoder();
    this.pending = [];
    this.connectedAt = Date.now();
    // 稳定在线 15s 才认为连接可用，避免「连上即被踢」导致退避一直被重置
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      this.attempts = 0;
    }, 15_000);
    this.deps.log(this.cfg.id, `已连接 ${this.deps.server().host}:${this.deps.server().port}`);

    const srv = this.deps.server();
    if (srv.registerOnConnect) this.sendFrame(FT.REGISTER, [0xff, 0xff]);
    // 上线先补一包历史数据：0x10 → 0x20 → 0x30（平台历史页依赖这几帧）
    this.reportHistory('connect');
    this.startTimers();
    this.notify();
  }

  private startTimers(): void {
    this.stopTimers();
    const srv = this.deps.server();
    const statusMs = Math.max(5, srv.statusIntervalSec) * 1000;
    const powerMs = Math.max(30, srv.powerIntervalSec) * 1000;
    const envMs = Math.min(3600, Math.max(120, srv.envIntervalSec || 3600)) * 1000;
    this.statusTimer = setInterval(() => this.sendStatus(), statusMs);
    if (srv.hourlyBundle) {
      // 整包模式：默认对齐整点，平台历史数据通常按整点落一行
      this.scheduleNextBundle();
    } else {
      this.powerTimer = setInterval(() => this.sendPower(), powerMs);
      if (srv.envReport) this.envTimer = setInterval(() => this.sendEnv(), envMs);
    }
  }

  /** 递归排下一次整包：整点对齐时每次都重算到下一个 :00:05 */
  private scheduleNextBundle(): void {
    const srv = this.deps.server();
    let delay = Math.max(30, srv.powerIntervalSec) * 1000;
    if (srv.alignHourly) {
      const now = new Date();
      const next = new Date(now.getTime());
      next.setMinutes(0, 5, 0);
      if (next.getTime() <= now.getTime()) next.setHours(next.getHours() + 1);
      delay = next.getTime() - now.getTime();
    }
    this.bundleTimer = setTimeout(() => {
      this.bundleTimer = null;
      this.reportHistory('auto');
      this.scheduleNextBundle();
    }, delay);
  }

  private stopTimers(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.powerTimer) clearInterval(this.powerTimer);
    if (this.envTimer) clearInterval(this.envTimer);
    if (this.bundleTimer) clearTimeout(this.bundleTimer);
    if (this.reportTimer) clearTimeout(this.reportTimer);
    if (this.envReportTimer) clearTimeout(this.envReportTimer);
    this.statusTimer = null;
    this.powerTimer = null;
    this.envTimer = null;
    this.bundleTimer = null;
    this.reportTimer = null;
    this.envReportTimer = null;
  }

  private onClose(): void {
    const lived = this.connectedAt ? Date.now() - this.connectedAt : 0;
    this.connectedAt = 0;
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    this.stopTimers();
    this.clearAutoTimers();
    this.pending = [];
    if (!this.closedByUser && lived > 0 && lived < 1500) {
      const last = this.lastTxType === null ? '' : `，最后发送 0x${this.lastTxType.toString(16).padStart(2, '0')}`;
      this.error = `服务端在连接后 ${lived}ms 主动断开${last}。可能是该模块 ID 已有其他会话在线，或平台不接受该帧类型`;
    }
    if (this.link !== 'idle') this.link = this.closedByUser ? 'idle' : 'offline';
    this.sock = null;
    this.notify();

    const srv = this.deps.server();
    if (!this.closedByUser && srv.autoReconnect) {
      const delay = Math.min(30_000, 800 * 2 ** Math.min(this.attempts, 5));
      this.attempts += 1;
      this.deps.log(this.cfg.id, `${Math.round(delay / 1000)}s 后重连（第 ${this.attempts} 次）`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.closedByUser) this.connect();
      }, delay);
    }
  }

  private teardownSocket(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.connectTimer = null;
    this.reconnectTimer = null;
    this.stableTimer = null;
    this.connectedAt = 0;
    this.stopTimers();
    this.clearAutoTimers();
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      sock.removeAllListeners();
      sock.on('error', () => {});
      sock.destroy();
    }
  }

  dispose(): void {
    this.closedByUser = true;
    this.teardownSocket();
  }

  /* ------------------------------------------------------------- 收发 */

  private onData(chunk: Buffer): void {
    let frames;
    try {
      frames = this.decoder.push(new Uint8Array(chunk));
    } catch (err) {
      this.deps.log(this.cfg.id, `拆帧异常：${(err as Error).message}`);
      return;
    }
    for (const frame of frames) {
      this.lastRx = Date.now();
      this.rxCount += 1;
      const parsed = describe(frame, this.cfg.protocol);
      this.deps.onFrame({
        ts: this.lastRx,
        moduleId: this.cfg.id,
        moduleLabel: this.label(),
        dir: 'rx',
        parsed,
      });
      if (frame.type === FT.CMD) this.handleCommand(frame.data);
      if (frame.type === FT.POWER_ACK) this.lastPowerAck = this.lastRx;
      if (frame.type === FT.ENV_ACK) this.lastEnvAck = this.lastRx;
    }
    if (this.decoder.skippedBytes > 0) {
      this.deps.log(this.cfg.id, `丢弃 ${this.decoder.skippedBytes} 个无法同步的字节`);
      this.decoder.skippedBytes = 0;
    }
    this.notify();
  }

  private handleCommand(data: Uint8Array): void {
    const srv = this.deps.server();
    if (srv.ackCommand) this.sendFrame(FT.CMD_ACK, [0x00]);
    const profile = getProfile(this.cfg.protocol);
    const { actions, allZero } = decodeCommand(data, profile);
    // 约定：数据区全 0（5A470500xx00 0000****）表示电池活化关闭（仅 MG400 有活化指令）
    if (allZero && profile.hasActivation) {
      if (this.cfg.devices.includes('activation')) {
        actions.push({ slot: 'activation', kind: 'off', label: '电池活化 关闭（数据区全 0）' });
      } else {
        this.deps.log(this.cfg.id, '收到数据区全 0 的命令帧（按约定为活化关闭），该模块未配置电池活化，已忽略');
      }
    }
    if (!actions.length) return;

    const now = Date.now();
    this.lastCommandAt = now;
    const added: PendingAction[] = [];
    for (const action of actions) {
      const key = this.keyForSlot(action.slot);
      if (!key) {
        this.deps.log(this.cfg.id, `收到 ${action.label}，但该模块未配置对应设备，已忽略`);
        continue;
      }
      const target = TARGET_OF_KIND[action.kind];
      const dup = this.pending.find((p) => p.key === key && p.target === target);
      if (dup) continue;
      const conflict = this.pending.some((p) => p.key === key && p.target !== target);
      if (conflict) for (const p of this.pending) if (p.key === key) p.conflict = true;
      const item: PendingAction = {
        id: randomUUID(),
        key,
        kind: action.kind,
        target,
        label: action.label,
        at: now,
        conflict,
      };
      this.pending.push(item);
      added.push(item);
    }
    if (added.length) this.deps.log(this.cfg.id, `收到命令：${added.map((a) => a.label).join(' + ')}`);
    this.notify();
    if (this.deps.autoEnabled(this.cfg)) this.scheduleAuto(added);
  }

  private keyForSlot(slot: string): string | null {
    return this.cfg.devices.includes(slot) ? slot : null;
  }

  /* ------------------------------------------------------------- 自动模式 */

  private scheduleAuto(items: PendingAction[]): void {
    const srv = this.deps.server();
    const base = Math.max(0, srv.autoDelaySec) * 1000;
    const list = items.filter((p) => !p.conflict);
    list.forEach((item, index) => {
      const jitter = srv.autoJitterMs > 0 ? Math.random() * srv.autoJitterMs : 0;
      const wait = (srv.autoParallel ? base : base * (index + 1)) + jitter;
      const timer = setTimeout(() => {
        this.autoTimers.delete(item.id);
        this.applyPending(item.id, 'auto');
      }, wait);
      this.autoTimers.set(item.id, timer);
    });
    if (list.length) {
      this.deps.log(
        this.cfg.id,
        `自动模式：${list.length} 个动作将在 ${srv.autoParallel ? '并行' : '串行'} ${base / 1000}s 后到位`,
      );
    }
  }

  private clearAutoTimers(ids?: string[]): void {
    if (ids) {
      for (const id of ids) {
        const t = this.autoTimers.get(id);
        if (t) clearTimeout(t);
        this.autoTimers.delete(id);
      }
      return;
    }
    for (const t of this.autoTimers.values()) clearTimeout(t);
    this.autoTimers.clear();
  }

  applyPending(id: string, source: 'user' | 'auto'): void {
    const item = this.pending.find((p) => p.id === id);
    if (!item) return;
    if (item.conflict && source === 'auto') return;
    this.clearAutoTimers([id]);
    this.pending = this.pending.filter((p) => p.id !== id);
    this.cfg.states[item.key] = item.target;
    const meta = deviceMeta(item.key);
    this.deps.log(this.cfg.id, `${source === 'auto' ? '自动' : '人工'}确认：${meta.name} → ${item.label}`);
    this.deps.onChange();
    this.scheduleReport();
  }

  dismissPending(id: string): void {
    const item = this.pending.find((p) => p.id === id);
    if (!item) return;
    this.clearAutoTimers([id]);
    this.pending = this.pending.filter((p) => p.id !== id);
    this.deps.log(this.cfg.id, `忽略命令：${item.label}`);
    this.notify();
  }

  /* ------------------------------------------------------------- 状态与上报 */

  setDevice(key: string, state: string): void {
    if (!this.cfg.devices.includes(key)) return;
    this.cfg.states[key] = state;
    const affected = this.pending.filter((p) => p.key === key);
    if (affected.length) {
      this.clearAutoTimers(affected.map((p) => p.id));
      this.pending = this.pending.filter((p) => p.key !== key);
    }
    this.deps.onChange();
    this.scheduleReport();
  }

  setTelemetry(patch: Partial<ModuleConfig['telemetry']>): void {
    this.cfg.telemetry = { ...this.cfg.telemetry, ...patch };
    this.deps.onChange();
    this.scheduleReport();
    if (ENV_KEYS.some((key) => key in patch)) this.scheduleEnv();
  }

  /** 一键初始态 / 融冰态：清空待动作，整批改状态后立即上报 */
  applyPreset(states: Record<string, string>): void {
    for (const key of this.cfg.devices) {
      const value = states[key];
      if (value) this.cfg.states[key] = value;
    }
    this.pending = [];
    this.clearAutoTimers();
    this.deps.onChange();
    this.sendStatus();
  }

  private scheduleReport(): void {
    if (this.reportTimer) clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null;
      this.sendStatus();
    }, 80);
  }

  private scheduleEnv(): void {
    if (this.envReportTimer) clearTimeout(this.envReportTimer);
    this.envReportTimer = setTimeout(() => {
      this.envReportTimer = null;
      this.sendEnv();
    }, 120);
  }

  sendStatus(): void {
    if (!this.isOnline()) return;
    const st = this.cfg.states;
    const profile = getProfile(this.cfg.protocol);
    const data = profile.encodeStatus({
      ground: (st.ground as DeviceState) ?? 'closed',
      ground2: st.ground2 as DeviceState | undefined,
      ice: (st.ice as DeviceState) ?? 'open',
      lock: (st.lock as DeviceState) ?? 'locked',
      phases: [
        (st.phase1 as DeviceState) ?? 'open',
        (st.phase2 as DeviceState) ?? 'open',
        (st.phase3 as DeviceState) ?? 'open',
      ],
      controlMode: this.cfg.telemetry.controlMode,
      networkError: this.cfg.telemetry.networkError,
      batteryPercent: this.cfg.telemetry.batteryPercent,
      linkType: this.cfg.telemetry.linkType,
    });
    this.sendFrame(FT.DI, data);
  }

  sendPower(): void {
    if (!this.isOnline()) return;
    this.sendFrame(FT.POWER, encodePower(this.cfg.telemetry));
  }

  sendEnv(): void {
    if (!this.isOnline()) return;
    if (!this.deps.server().envReport) return;
    this.sendFrame(FT.ENV, encodeEnv(this.cfg.telemetry));
  }

  /**
   * 历史整包：0x10 + 0x20（开启 0x30 上报时再加环境帧）连续发送。
   * 平台历史数据页需要同一时刻的刀闸状态与电池/太阳能数据。
   */
  reportHistory(source: 'connect' | 'auto' | 'manual' = 'manual'): void {
    if (!this.isOnline()) {
      if (source === 'manual') this.deps.log(this.cfg.id, '当前未连接，历史整包发送被丢弃');
      return;
    }
    const withEnv = this.deps.server().envReport;
    this.sendStatus();
    this.sendPower();
    if (withEnv) this.sendEnv();
    this.lastHistoryAt = Date.now();
    this.deps.log(this.cfg.id, `历史整包已上报（0x10 + 0x20${withEnv ? ' + 0x30' : ''}，来源 ${source}）`);
    this.notify();
  }

  /** 任意帧发送（帧构造器 / 手动发帧） */
  sendRaw(raw: Uint8Array): void {
    if (!this.isOnline()) {
      this.deps.log(this.cfg.id, '当前未连接，发送被丢弃');
      return;
    }
    this.write(raw);
  }

  private sendFrame(type: number, data: ArrayLike<number>): void {
    const srv = this.deps.server();
    const buf = encodeFrame({
      id: this.cfg.moduleId,
      type,
      data,
      crcMode: srv.crcMode === 'zero' ? 'zero' : 'auto',
    });
    this.write(buf);
  }

  private write(raw: Uint8Array): void {
    const sock = this.sock;
    if (!sock || sock.destroyed) return;
    sock.write(Buffer.from(raw));
    this.lastTx = Date.now();
    this.lastTxType = raw[5] ?? null;
    this.txCount += 1;
    this.deps.onFrame({
      ts: this.lastTx,
      moduleId: this.cfg.id,
      moduleLabel: this.label(),
      dir: 'tx',
      parsed: describe(decodeFrame(raw)),
    });
    this.notify();
  }

  isOnline(): boolean {
    return this.link === 'online' && !!this.sock && !this.sock.destroyed && this.sock.writable;
  }

  private label(): string {
    return `${this.cfg.towerName || '未命名铁塔'} #${this.cfg.moduleId}`;
  }

  private notify(): void {
    this.deps.onChange();
  }
}
