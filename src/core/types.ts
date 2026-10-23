import type { CommandKind, ProtocolId } from '../protocol/bits';
import type { ParsedFrame } from '../protocol/describe';

export interface ServerConfig {
  host: string;
  port: number;
  connectTimeoutMs: number;
  autoReconnect: boolean;
  /** 连上后发送 0x05 FF FF（协议文档未定义，实测平台回心跳，可关） */
  registerOnConnect: boolean;
  crcMode: 'auto' | 'zero';
  statusIntervalSec: number;
  powerIntervalSec: number;
  /** 0x30 环境状态上报周期（秒），协议要求 120~3600 */
  envIntervalSec: number;
  /**
   * 是否上报 0x30 环境帧。默认关闭：
   * 实测本平台收到 0x30 会在 30ms 内断开 TCP 连接（2026-10-24 用未占用 ID 复现）。
   */
  envReport: boolean;
  /** 每小时把 0x10 + 0x20 + 0x30 连成一包上报（平台历史数据依赖整包） */
  hourlyBundle: boolean;
  /** 整包对齐到整点（每小时 :00:05），而不是从连接时刻起算 */
  alignHourly: boolean;
  autoModeDefault: boolean;
  autoDelaySec: number;
  autoJitterMs: number;
  autoParallel: boolean;
  /** 收到 0x00 后立即回 0x01 */
  ackCommand: boolean;
}

export const DEFAULT_SERVER: ServerConfig = {
  host: '',
  port: 3000,
  connectTimeoutMs: 8000,
  autoReconnect: true,
  registerOnConnect: true,
  crcMode: 'auto',
  statusIntervalSec: 60,
  powerIntervalSec: 3600,
  envIntervalSec: 3600,
  envReport: false,
  hourlyBundle: true,
  alignHourly: true,
  autoModeDefault: false,
  autoDelaySec: 3,
  autoJitterMs: 0,
  autoParallel: false,
  ackCommand: true,
};

export interface Telemetry {
  batteryPercent: number;
  batteryVoltage: number;
  pvVoltage: number;
  pvCurrent: number;
  loadVoltage: number;
  loadCurrent: number;
  controlMode: 'remote' | 'local';
  networkError: boolean;
  /** MG500 才有：通信链路上报（0=4G / 1=光纤） */
  linkType?: '4g' | 'fiber';
  /* ---- 以下为 0x30 环境状态（不填则按 0xFFFF 上报为「数据异常」） ---- */
  envTemp?: number;
  envHumidity?: number;
  cell1Temp?: number;
  cell2Temp?: number;
  /** 空调状态：0 未通电 / 1 待机 / 2 运行 / 3 故障 */
  acState?: number;
  fireUsed?: boolean;
}

export type AutoMode = 'inherit' | 'on' | 'off';

export interface ModuleConfig {
  id: string;
  /** 该模块使用的协议：mg400 / mg500 */
  protocol: ProtocolId;
  towerName: string;
  /** 写入帧 ID 字段的 12bit 原值（bit0 = 大小号侧） */
  moduleId: number;
  phaseCount: number;
  /** 设备 key 的顺序即界面顺序 */
  devices: string[];
  states: Record<string, string>;
  telemetry: Telemetry;
  autoMode: AutoMode;
  autoConnect: boolean;
}

export type LinkState = 'idle' | 'connecting' | 'online' | 'offline';

export interface PendingAction {
  id: string;
  key: string;
  kind: CommandKind;
  target: string;
  label: string;
  at: number;
  conflict: boolean;
}

export interface ModuleSnapshot extends ModuleConfig {
  link: LinkState;
  lastRx: number | null;
  lastTx: number | null;
  attempts: number;
  error: string | null;
  pending: PendingAction[];
  rxCount: number;
  txCount: number;
  lastCommandAt: number | null;
  /** 最近一次「历史整包」上报时间 */
  lastHistoryAt: number | null;
  /** 平台对 0x20 / 0x30 的应答时间（null = 未收到应答） */
  lastPowerAck: number | null;
  lastEnvAck: number | null;
}

export interface FrameEntry {
  seq: number;
  ts: number;
  moduleId: string;
  moduleLabel: string;
  dir: 'tx' | 'rx';
  parsed: ParsedFrame;
}

export interface AppState {
  server: ServerConfig;
  modules: ModuleSnapshot[];
  startedAt: number;
}

export interface DeviceMeta {
  name: string;
  kind: 'switch' | 'lock' | 'phase' | 'activation';
}

export function deviceMeta(key: string): DeviceMeta {
  if (key === 'ground') return { name: '接地刀闸', kind: 'switch' };
  if (key === 'ground2') return { name: '接地刀闸 2', kind: 'switch' };
  if (key === 'ice') return { name: '融冰刀闸', kind: 'switch' };
  if (key === 'lock') return { name: '融冰锁', kind: 'lock' };
  if (key === 'activation') return { name: '电池活化', kind: 'activation' };
  const m = /^phase(\d+)$/.exec(key);
  if (m) return { name: `选相刀闸 ${m[1]}`, kind: 'phase' };
  return { name: key, kind: 'switch' };
}

export function deviceStates(key: string): Array<{ value: string; label: string }> {
  const kind = deviceMeta(key).kind;
  if (kind === 'lock')
    return [
      { value: 'locked', label: '闭锁到位' },
      { value: 'unlocked', label: '开锁到位' },
    ];
  if (kind === 'activation')
    return [
      { value: 'off', label: '活化关闭' },
      { value: 'on', label: '活化开启' },
    ];
  return [
    { value: 'closed', label: '合闸到位' },
    { value: 'open', label: '分闸到位' },
  ];
}

export type ButtonTone = 'initial' | 'moving' | 'melt';

export interface DeviceButton {
  value: string;
  label: string;
  tone: ButtonTone;
}

/**
 * 三列按钮：左=初始态（绿）、中=动作中（橙）、右=融冰态（红）。
 * 中间按钮的文案随当前状态变化：从左往右动 →「分闸中 / 开锁中」，从右往左动 →「合闸中 / 闭锁中」。
 */
export function deviceButtons(key: string, current: string | undefined): DeviceButton[] {
  const kind = deviceMeta(key).kind;
  const cur = current ?? '';

  if (kind === 'activation') {
    return [
      { value: 'off', label: '活化关闭', tone: 'initial' },
      { value: 'on', label: '活化开启', tone: 'melt' },
    ];
  }

  if (kind === 'lock') {
    const mid: DeviceButton =
      cur === 'unlocked' || cur === 'locking'
        ? { value: 'locking', label: '闭锁中', tone: 'moving' }
        : { value: 'unlocking', label: '开锁中', tone: 'moving' };
    return [
      { value: 'locked', label: '闭锁到位', tone: 'initial' },
      mid,
      { value: 'unlocked', label: '开锁到位', tone: 'melt' },
    ];
  }

  const leftIsClosed = kind === 'switch' && (key === 'ground' || key === 'ground2');
  const mid: DeviceButton = leftIsClosed
    ? cur === 'open' || cur === 'closing'
      ? { value: 'closing', label: '合闸中', tone: 'moving' }
      : { value: 'opening', label: '分闸中', tone: 'moving' }
    : cur === 'closed' || cur === 'opening'
      ? { value: 'opening', label: '分闸中', tone: 'moving' }
      : { value: 'closing', label: '合闸中', tone: 'moving' };

  return leftIsClosed
    ? [
        { value: 'closed', label: '合闸到位', tone: 'initial' },
        mid,
        { value: 'open', label: '分闸到位', tone: 'melt' },
      ]
    : [
        { value: 'open', label: '分闸到位', tone: 'initial' },
        mid,
        { value: 'closed', label: '合闸到位', tone: 'melt' },
      ];
}

/** 初始态（最左列）：接地合、选相分、锁闭锁、融冰分、活化关 */
export const INITIAL_STATE: Record<string, string> = {
  ground: 'closed',
  ground2: 'closed',
  ice: 'open',
  lock: 'locked',
  activation: 'off',
};

/** 融冰态（最右列）：接地分、选相合、锁开、融冰合 */
export const MELT_STATE: Record<string, string> = {
  ground: 'open',
  ground2: 'open',
  ice: 'closed',
  lock: 'unlocked',
};

/**
 * 生成一份完整的一键预设状态表（含选相刀闸）。
 * 初始态：选相分闸到位；融冰态：选相合闸到位。
 */
export function presetStates(devices: string[], preset: 'initial' | 'melt'): Record<string, string> {
  const base = preset === 'initial' ? INITIAL_STATE : MELT_STATE;
  const out: Record<string, string> = {};
  for (const key of devices) {
    if (key.startsWith('phase')) {
      out[key] = preset === 'initial' ? 'open' : 'closed';
    } else if (base[key]) {
      out[key] = base[key];
    }
  }
  return out;
}

/** 默认展示顺序：接地刀闸 → 选相刀闸(1..n) → 融冰锁 → 融冰刀闸 → 电池活化 */
export function orderDevices(keys: string[]): string[] {
  const rank = (key: string): number => {
    if (key === 'ground') return 0;
    if (key === 'ground2') return 1;
    if (key.startsWith('phase')) return 2;
    if (key === 'lock') return 3;
    if (key === 'ice') return 4;
    if (key === 'activation') return 5;
    return 6;
  };
  return [...keys].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const na = Number(/^phase(\d+)$/.exec(a)?.[1] ?? 0);
    const nb = Number(/^phase(\d+)$/.exec(b)?.[1] ?? 0);
    return na - nb;
  });
}

/** 该协议下 0x10 状态帧里是否有对应位 */
export function hasStatusBit(key: string, protocol: ProtocolId = 'mg400'): boolean {
  if (key === 'activation') return false;
  if (key === 'ground2') return protocol === 'mg500';
  if (key === 'phase3') return protocol === 'mg500';
  return !/^phase([4-9]|\d{2,})$/.test(key);
}

function randStep(min: number, max: number, step: number): number {
  const n = Math.floor(Math.random() * ((max - min) / step + 1));
  return Math.round((min + n * step) * 1000) / 1000;
}

export function randomTelemetry(): Telemetry {
  const batteryVoltage = randStep(46, 56, 0.1);
  return {
    batteryPercent: Math.round(randStep(50, 100, 1)),
    batteryVoltage,
    pvVoltage: randStep(30, 79, 0.1),
    pvCurrent: randStep(0, 3, 0.01),
    loadVoltage: Math.round((batteryVoltage + randStep(-0.2, 0.2, 0.1)) * 10) / 10,
    loadCurrent: randStep(0.3, 0.8, 0.01),
    controlMode: 'remote',
    networkError: false,
    linkType: '4g',
    envTemp: randStep(15, 38, 0.1),
    envHumidity: randStep(35, 75, 0.1),
    cell1Temp: randStep(18, 34, 0.1),
    cell2Temp: randStep(18, 34, 0.1),
    acState: 2,
    fireUsed: false,
  };
}
