import type { ActivationStatusBit, CommandKind } from '../protocol/bits';
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
  autoModeDefault: boolean;
  autoDelaySec: number;
  autoJitterMs: number;
  autoParallel: boolean;
  /** 收到 0x00 后立即回 0x01 */
  ackCommand: boolean;
  /** 0x10 里活化状态占用的位：b1（默认，与命令帧同位）/ b0 / none（不上报，保留 4 档电量） */
  activationStatusBit: ActivationStatusBit;
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
  autoModeDefault: false,
  autoDelaySec: 3,
  autoJitterMs: 0,
  autoParallel: false,
  ackCommand: true,
  activationStatusBit: 'b1',
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
}

export type AutoMode = 'inherit' | 'on' | 'off';

export interface ModuleConfig {
  id: string;
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

  const leftIsClosed = kind === 'switch' && key === 'ground';
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
  ice: 'open',
  lock: 'locked',
  activation: 'off',
};

/** 融冰态（最右列）：接地分、选相合、锁开、融冰合 */
export const MELT_STATE: Record<string, string> = {
  ground: 'open',
  ice: 'closed',
  lock: 'unlocked',
};

/** 默认展示顺序：接地刀闸 → 选相刀闸(1..n) → 融冰锁 → 融冰刀闸 → 电池活化 */
export function orderDevices(keys: string[]): string[] {
  const rank = (key: string): number => {
    if (key === 'ground') return 0;
    if (key.startsWith('phase')) return 1;
    if (key === 'lock') return 2;
    if (key === 'ice') return 3;
    if (key === 'activation') return 4;
    return 5;
  };
  return [...keys].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const na = Number(/^phase(\d+)$/.exec(a)?.[1] ?? 0);
    const nb = Number(/^phase(\d+)$/.exec(b)?.[1] ?? 0);
    return na - nb;
  });
}

/** 0x10 状态帧里有对应位的设备（选相 3 个以上没有位定义） */
export function hasStatusBit(key: string): boolean {
  return key !== 'activation' && !/^phase([3-9]|\d{2,})$/.test(key);
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
  };
}
