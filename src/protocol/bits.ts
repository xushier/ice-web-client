/**
 * 位映射表。
 *
 * 重要：命令帧（0x00）与状态帧（0x10）的位布局**不一致**，必须分开维护。
 *   接地刀闸：命令帧 Byte1 b7/b6；状态帧 Byte0 b0（合）+ Byte1 b7（分）
 *   融冰锁  ：命令帧 Byte0 b1/b0；状态帧 Byte0 b2（闭锁）/b1（开锁）
 */

export type SwitchState = 'open' | 'closed';
export type LockState = 'locked' | 'unlocked';
export type ActivationState = 'off' | 'on';
export type ControlMode = 'remote' | 'local';
export type DeviceSlot = 'ground' | 'ice' | 'lock' | 'phase1' | 'phase2' | 'discharge';
export type CommandKind = 'close' | 'open' | 'lock' | 'unlock';

export const SWITCH_LABEL: Record<SwitchState, string> = {
  closed: '合闸到位',
  open: '分闸到位',
};

export const LOCK_LABEL: Record<LockState, string> = {
  locked: '闭锁到位',
  unlocked: '开锁到位',
};

export const KIND_LABEL: Record<CommandKind, string> = {
  close: '合闸',
  open: '分闸',
  lock: '闭锁',
  unlock: '开锁',
};

/* ---------------------------------------------------------------- 0x00 命令帧 */

export interface CommandBitDef {
  byte: 0 | 1;
  bit: number;
  slot: DeviceSlot | 'spare';
  kind: CommandKind | null;
  label: string;
}

export const COMMAND_BITS: CommandBitDef[] = [
  { byte: 0, bit: 7, slot: 'spare', kind: null, label: '保留 bh7' },
  { byte: 0, bit: 6, slot: 'spare', kind: null, label: '保留 bh6' },
  { byte: 0, bit: 5, slot: 'spare', kind: null, label: '保留 bh5' },
  { byte: 0, bit: 4, slot: 'spare', kind: null, label: '保留 bh4' },
  { byte: 0, bit: 3, slot: 'ice', kind: 'close', label: '融冰刀闸 合闸' },
  { byte: 0, bit: 2, slot: 'ice', kind: 'open', label: '融冰刀闸 分闸' },
  { byte: 0, bit: 1, slot: 'lock', kind: 'lock', label: '融冰锁 闭锁' },
  { byte: 0, bit: 0, slot: 'lock', kind: 'unlock', label: '融冰锁 开锁' },
  { byte: 1, bit: 7, slot: 'ground', kind: 'close', label: '接地刀闸 合闸' },
  { byte: 1, bit: 6, slot: 'ground', kind: 'open', label: '接地刀闸 分闸' },
  { byte: 1, bit: 5, slot: 'phase1', kind: 'close', label: '选相刀闸 1 合闸' },
  { byte: 1, bit: 4, slot: 'phase1', kind: 'open', label: '选相刀闸 1 分闸' },
  { byte: 1, bit: 3, slot: 'phase2', kind: 'close', label: '选相刀闸 2 合闸' },
  { byte: 1, bit: 2, slot: 'phase2', kind: 'open', label: '选相刀闸 2 分闸' },
  { byte: 1, bit: 1, slot: 'discharge', kind: null, label: '泄放电阻（备用）' },
  { byte: 1, bit: 0, slot: 'spare', kind: null, label: '备用 bl0' },
];

export interface CommandAction {
  slot: DeviceSlot;
  kind: CommandKind;
  label: string;
}

export function decodeCommand(data: Uint8Array): { actions: CommandAction[]; reserved: number } {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  const actions: CommandAction[] = [];
  for (const def of COMMAND_BITS) {
    if (!def.slot || def.slot === 'spare' || !def.kind) continue;
    const byteVal = def.byte === 0 ? b0 : b1;
    if (byteVal & (1 << def.bit)) {
      actions.push({ slot: def.slot, kind: def.kind, label: def.label });
    }
  }
  return { actions, reserved: b0 & 0xf0 };
}

export function encodeCommand(actions: Array<{ slot: DeviceSlot; kind: CommandKind }>): Uint8Array {
  let b0 = 0;
  let b1 = 0;
  for (const a of actions) {
    const def = COMMAND_BITS.find((d) => d.slot === a.slot && d.kind === a.kind);
    if (!def) continue;
    if (def.byte === 0) b0 |= 1 << def.bit;
    else b1 |= 1 << def.bit;
  }
  return Uint8Array.from([b0, b1]);
}

/* ---------------------------------------------------------------- 0x10 状态帧 */

export interface StatusSnapshot {
  ground: SwitchState;
  ice: SwitchState;
  lock: LockState;
  phases: SwitchState[];
  controlMode: ControlMode;
  networkError: boolean;
  batteryPercent: number;
}

export interface StatusBitDef {
  byte: 0 | 1;
  bit: number;
  label: string;
  meaning: string;
}

export const STATUS_BITS: StatusBitDef[] = [
  { byte: 0, bit: 7, label: '备用 bh7', meaning: '备用' },
  { byte: 0, bit: 6, label: '备用 bh6', meaning: '备用' },
  { byte: 0, bit: 5, label: '网络错误 bh5', meaning: '1=网络错误 / 0=网络正常' },
  { byte: 0, bit: 4, label: '融冰刀闸合 bh4', meaning: '1=合闸到位' },
  { byte: 0, bit: 3, label: '融冰刀闸分 bh3', meaning: '1=分闸到位' },
  { byte: 0, bit: 2, label: '融冰锁闭锁 bh2', meaning: '1=闭锁到位' },
  { byte: 0, bit: 1, label: '融冰锁开锁 bh1', meaning: '1=开锁到位' },
  { byte: 0, bit: 0, label: '接地刀闸合 bh0', meaning: '1=合闸到位' },
  { byte: 1, bit: 7, label: '接地刀闸分 bl7', meaning: '1=分闸到位' },
  { byte: 1, bit: 6, label: '选相1合 bl6', meaning: '1=合闸到位' },
  { byte: 1, bit: 5, label: '选相1分 bl5', meaning: '1=分闸到位' },
  { byte: 1, bit: 4, label: '选相2合 bl4', meaning: '1=合闸到位' },
  { byte: 1, bit: 3, label: '选相2分 bl3', meaning: '1=分闸到位' },
  { byte: 1, bit: 2, label: '控制模式本地 bl2', meaning: '1=本地 / 0=远程' },
  { byte: 1, bit: 1, label: '电量档 bl1', meaning: '电池电量粗略值 bit1' },
  { byte: 1, bit: 0, label: '电量档 bl0', meaning: '电池电量粗略值 bit0' },
];

/** 电量百分比 → 4 档（0 / 25 / 50 / 75，与 MG200 兼容） */
export function coarseBattery(percent: number): number {
  return Math.max(0, Math.min(3, Math.floor(percent / 25)));
}

export function encodeStatus(s: StatusSnapshot): Uint8Array {
  let b0 = 0;
  let b1 = 0;
  if (s.ground === 'closed') b0 |= 0x01;
  if (s.lock === 'locked') b0 |= 0x04;
  else b0 |= 0x02;
  if (s.ice === 'open') b0 |= 0x08;
  else b0 |= 0x10;
  if (s.networkError) b0 |= 0x20;

  if (s.ground === 'open') b1 |= 0x80;
  const p1 = s.phases[0];
  if (p1 === 'closed') b1 |= 0x40;
  else if (p1 === 'open') b1 |= 0x20;
  const p2 = s.phases[1];
  if (p2 === 'closed') b1 |= 0x10;
  else if (p2 === 'open') b1 |= 0x08;
  if (s.controlMode === 'local') b1 |= 0x04;
  b1 |= coarseBattery(s.batteryPercent) & 0x03;
  return Uint8Array.from([b0, b1]);
}

export function statusBitsOf(data: Uint8Array): Array<{ bit: number; on: boolean; label: string }> {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  return STATUS_BITS.map((def) => ({
    bit: def.byte === 0 ? 8 + def.bit : def.bit,
    on: (((def.byte === 0 ? b0 : b1) >> def.bit) & 1) === 1,
    label: def.label,
  }));
}

export function commandBitsOf(data: Uint8Array): Array<{ bit: number; on: boolean; label: string }> {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  return COMMAND_BITS.map((def) => ({
    bit: def.byte === 0 ? 8 + def.bit : def.bit,
    on: (((def.byte === 0 ? b0 : b1) >> def.bit) & 1) === 1,
    label: def.label,
  }));
}

export function describeStatus(data: Uint8Array): string[] {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  const out: string[] = [];
  out.push(b0 & 0x01 ? '接地刀闸合' : '接地刀闸非合位');
  out.push(b1 & 0x80 ? '接地刀闸分' : '');
  out.push(b0 & 0x10 ? '融冰刀闸合' : '');
  out.push(b0 & 0x08 ? '融冰刀闸分' : '');
  out.push(b0 & 0x04 ? '融冰锁闭锁' : '');
  out.push(b0 & 0x02 ? '融冰锁开锁' : '');
  if (b1 & 0x40) out.push('选相1合');
  if (b1 & 0x20) out.push('选相1分');
  if (b1 & 0x10) out.push('选相2合');
  if (b1 & 0x08) out.push('选相2分');
  out.push(b1 & 0x04 ? '控制模式本地' : '控制模式远程');
  out.push(`电量档 ${b1 & 0x03}`);
  if (b0 & 0x20) out.push('网络错误');
  return out.filter(Boolean);
}

export function defaultStates(phaseCount: number): Record<string, string> {
  const states: Record<string, string> = {
    ground: 'closed',
    ice: 'open',
    lock: 'locked',
    activation: 'off',
  };
  for (let i = 1; i <= phaseCount; i++) states[`phase${i}`] = 'closed';
  return states;
}
