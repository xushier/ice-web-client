import type { CommandKind } from '../protocol/bits';
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
      { value: 'off', label: '关' },
      { value: 'on', label: '开' },
    ];
  return [
    { value: 'closed', label: '合闸到位' },
    { value: 'open', label: '分闸到位' },
  ];
}

/** 阶段 1/2 之外没有协议位，不参与 0x10 上报 */
export function reportsInStatus(key: string): boolean {
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
