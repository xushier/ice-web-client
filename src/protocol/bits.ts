/**
 * 位映射表：MG400 / MG500 两套协议。
 *
 * 共同点：帧结构、帧类型、ID、CRC、0x20/0x30/0x02 都一样。
 * 差异（MG500 在 MG400 基础上）：
 *   1. 增加接地刀闸 2、选相刀闸 3；
 *   2. 0x10 取消电量档，这两个 bit 让给选相 3；
 *   3. 0x10 Byte0 b5 由「网络错误」改为「接地刀闸 2 分闸」，Byte0 b7 由「备用」改为「通信链路」，
 *      Byte0 b6 由「备用」改为「接地刀闸 2 合闸」。
 * 因此 0x10 的状态编码必须按协议分开，不能混合上报。
 */

export type SwitchState = 'closed' | 'open';
export type LockState = 'locked' | 'unlocked';
export type ActivationState = 'off' | 'on';
export type ControlMode = 'remote' | 'local';
export type LinkType = '4g' | 'fiber';
export type DeviceSlot =
  | 'ground'
  | 'ground2'
  | 'ice'
  | 'lock'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'activation';
export type CommandKind = 'close' | 'open' | 'lock' | 'unlock' | 'on' | 'off';

/** 设备状态：到位 / 动作中（动作中在 DI 帧里两位都为 0） */
export type DeviceState =
  | 'closed'
  | 'open'
  | 'closing'
  | 'opening'
  | 'locked'
  | 'unlocked'
  | 'locking'
  | 'unlocking'
  | 'on'
  | 'off';

export const SWITCH_LABEL: Record<string, string> = {
  closed: '合闸到位',
  open: '分闸到位',
  closing: '合闸中',
  opening: '分闸中',
};

export const LOCK_LABEL: Record<string, string> = {
  locked: '闭锁到位',
  unlocked: '开锁到位',
  locking: '闭锁中',
  unlocking: '开锁中',
};

export const ACT_LABEL: Record<string, string> = {
  off: '活化关闭',
  on: '活化开启',
};

export const KIND_LABEL: Record<CommandKind, string> = {
  close: '合闸',
  open: '分闸',
  lock: '闭锁',
  unlock: '开锁',
  on: '活化开',
  off: '活化关',
};

/* ---------------------------------------------------------------- 结构定义 */

export interface CommandBitDef {
  byte: 0 | 1;
  bit: number;
  slot: DeviceSlot | 'spare';
  kind: CommandKind | null;
  label: string;
  flag?: string;
}

export interface StatusBitDef {
  byte: 0 | 1;
  bit: number;
  label: string;
  meaning: string;
}

export interface StatusSnapshot {
  ground: DeviceState;
  /** MG500 才有 */
  ground2?: DeviceState;
  ice: DeviceState;
  lock: DeviceState;
  /** 依次为选相 1/2/3 */
  phases: DeviceState[];
  controlMode: ControlMode;
  /** MG400 才有 */
  networkError: boolean;
  batteryPercent: number;
  /** MG500 才有：通信链路 0=4G 1=光纤 */
  linkType?: LinkType;
}

export type ProtocolId = 'mg400' | 'mg500';

export interface ProtocolProfile {
  id: ProtocolId;
  label: string;
  commandBits: CommandBitDef[];
  statusBits: StatusBitDef[];
  encodeStatus(s: StatusSnapshot): Uint8Array;
  /** 该协议支持的设备 key */
  devices: string[];
  /** 该协议最大选相刀闸数 */
  maxPhases: number;
  hasActivation: boolean;
}

/* ---------------------------------------------------------------- MG400 */

export const MG400_COMMAND_BITS: CommandBitDef[] = [
  { byte: 0, bit: 7, slot: 'spare', kind: null, label: '保留 bh7' },
  { byte: 0, bit: 6, slot: 'spare', kind: null, label: '保留 bh6' },
  { byte: 0, bit: 5, slot: 'spare', kind: null, label: '保留 bh5' },
  { byte: 0, bit: 4, slot: 'spare', kind: null, label: '保留 bh4' },
  { byte: 0, bit: 3, slot: 'ice', kind: 'close', label: '融冰刀闸 合闸', flag: 'C1' },
  { byte: 0, bit: 2, slot: 'ice', kind: 'open', label: '融冰刀闸 分闸', flag: 'C2' },
  { byte: 0, bit: 1, slot: 'lock', kind: 'lock', label: '融冰锁 闭锁', flag: 'D1' },
  { byte: 0, bit: 0, slot: 'lock', kind: 'unlock', label: '融冰锁 开锁', flag: 'D2' },
  { byte: 1, bit: 7, slot: 'ground', kind: 'close', label: '接地刀闸 合闸', flag: 'A1' },
  { byte: 1, bit: 6, slot: 'ground', kind: 'open', label: '接地刀闸 分闸', flag: 'A2' },
  { byte: 1, bit: 5, slot: 'phase1', kind: 'close', label: '选相刀闸 1 合闸', flag: 'B1' },
  { byte: 1, bit: 4, slot: 'phase1', kind: 'open', label: '选相刀闸 1 分闸', flag: 'B2' },
  { byte: 1, bit: 3, slot: 'phase2', kind: 'close', label: '选相刀闸 2 合闸', flag: 'B3' },
  { byte: 1, bit: 2, slot: 'phase2', kind: 'open', label: '选相刀闸 2 分闸', flag: 'B4' },
  { byte: 1, bit: 1, slot: 'activation', kind: 'on', label: '电池活化 开启（生成器 E1）', flag: 'E1' },
  { byte: 1, bit: 0, slot: 'spare', kind: null, label: '备用 bl0' },
];

export const MG400_STATUS_BITS: StatusBitDef[] = [
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

/* ---------------------------------------------------------------- MG500 */

export const MG500_COMMAND_BITS: CommandBitDef[] = [
  { byte: 0, bit: 7, slot: 'ground2', kind: 'close', label: '接地刀闸 2 合闸', flag: 'F1' },
  { byte: 0, bit: 6, slot: 'ground2', kind: 'open', label: '接地刀闸 2 分闸', flag: 'F2' },
  { byte: 0, bit: 5, slot: 'phase3', kind: 'close', label: '选相刀闸 3 合闸', flag: 'G1' },
  { byte: 0, bit: 4, slot: 'phase3', kind: 'open', label: '选相刀闸 3 分闸', flag: 'G2' },
  { byte: 0, bit: 3, slot: 'ice', kind: 'close', label: '融冰刀闸 合闸', flag: 'C1' },
  { byte: 0, bit: 2, slot: 'ice', kind: 'open', label: '融冰刀闸 分闸', flag: 'C2' },
  { byte: 0, bit: 1, slot: 'lock', kind: 'lock', label: '融冰锁 闭锁', flag: 'D1' },
  { byte: 0, bit: 0, slot: 'lock', kind: 'unlock', label: '融冰锁 开锁', flag: 'D2' },
  { byte: 1, bit: 7, slot: 'ground', kind: 'close', label: '接地刀闸 1 合闸', flag: 'A1' },
  { byte: 1, bit: 6, slot: 'ground', kind: 'open', label: '接地刀闸 1 分闸', flag: 'A2' },
  { byte: 1, bit: 5, slot: 'phase1', kind: 'close', label: '选相刀闸 1 合闸', flag: 'B1' },
  { byte: 1, bit: 4, slot: 'phase1', kind: 'open', label: '选相刀闸 1 分闸', flag: 'B2' },
  { byte: 1, bit: 3, slot: 'phase2', kind: 'close', label: '选相刀闸 2 合闸', flag: 'B3' },
  { byte: 1, bit: 2, slot: 'phase2', kind: 'open', label: '选相刀闸 2 分闸', flag: 'B4' },
  { byte: 1, bit: 1, slot: 'spare', kind: null, label: '泄放电阻（备用）' },
  { byte: 1, bit: 0, slot: 'spare', kind: null, label: '备用 bl0' },
];

export const MG500_STATUS_BITS: StatusBitDef[] = [
  { byte: 0, bit: 7, label: '通信链路 bh7', meaning: '0=4G / 1=光纤' },
  { byte: 0, bit: 6, label: '接地2合 bh6', meaning: '1=合闸到位' },
  { byte: 0, bit: 5, label: '接地2分 bh5', meaning: '1=分闸到位' },
  { byte: 0, bit: 4, label: '融冰刀闸合 bh4', meaning: '1=合闸到位' },
  { byte: 0, bit: 3, label: '融冰刀闸分 bh3', meaning: '1=分闸到位' },
  { byte: 0, bit: 2, label: '融冰锁闭锁 bh2', meaning: '1=闭锁到位' },
  { byte: 0, bit: 1, label: '融冰锁开锁 bh1', meaning: '1=开锁到位' },
  { byte: 0, bit: 0, label: '接地1合 bh0', meaning: '1=合闸到位' },
  { byte: 1, bit: 7, label: '接地1分 bl7', meaning: '1=分闸到位' },
  { byte: 1, bit: 6, label: '选相1合 bl6', meaning: '1=合闸到位' },
  { byte: 1, bit: 5, label: '选相1分 bl5', meaning: '1=分闸到位' },
  { byte: 1, bit: 4, label: '选相2合 bl4', meaning: '1=合闸到位' },
  { byte: 1, bit: 3, label: '选相2分 bl3', meaning: '1=分闸到位' },
  { byte: 1, bit: 2, label: '控制模式本地 bl2', meaning: '1=本地 / 0=远程' },
  { byte: 1, bit: 1, label: '选相3合 bl1', meaning: '1=合闸到位' },
  { byte: 1, bit: 0, label: '选相3分 bl0', meaning: '1=分闸到位' },
];

/* ---------------------------------------------------------------- 编码 */

/** 电量百分比 → 4 档（0 / 25 / 50 / 75，与 MG200 兼容） */
export function coarseBattery(percent: number): number {
  return Math.max(0, Math.min(3, Math.floor(percent / 25)));
}

export function encodeMg400Status(s: StatusSnapshot): Uint8Array {
  let b0 = 0;
  let b1 = 0;
  if (s.ground === 'closed') b0 |= 0x01;
  if (s.ground === 'open') b1 |= 0x80;

  if (s.lock === 'locked') b0 |= 0x04;
  if (s.lock === 'unlocked') b0 |= 0x02;

  if (s.ice === 'open') b0 |= 0x08;
  if (s.ice === 'closed') b0 |= 0x10;

  if (s.networkError) b0 |= 0x20;

  const p1 = s.phases[0];
  if (p1 === 'closed') b1 |= 0x40;
  if (p1 === 'open') b1 |= 0x20;
  const p2 = s.phases[1];
  if (p2 === 'closed') b1 |= 0x10;
  if (p2 === 'open') b1 |= 0x08;

  if (s.controlMode === 'local') b1 |= 0x04;
  b1 |= coarseBattery(s.batteryPercent) & 0x03;
  return Uint8Array.from([b0, b1]);
}

export function encodeMg500Status(s: StatusSnapshot): Uint8Array {
  let b0 = 0;
  let b1 = 0;
  if (s.ground === 'closed') b0 |= 0x01;
  if (s.ground === 'open') b1 |= 0x80;

  if (s.ground2 === 'closed') b0 |= 0x40;
  if (s.ground2 === 'open') b0 |= 0x20;

  if (s.lock === 'locked') b0 |= 0x04;
  if (s.lock === 'unlocked') b0 |= 0x02;

  if (s.ice === 'open') b0 |= 0x08;
  if (s.ice === 'closed') b0 |= 0x10;

  if (s.linkType === 'fiber') b0 |= 0x80;

  const p1 = s.phases[0];
  if (p1 === 'closed') b1 |= 0x40;
  if (p1 === 'open') b1 |= 0x20;
  const p2 = s.phases[1];
  if (p2 === 'closed') b1 |= 0x10;
  if (p2 === 'open') b1 |= 0x08;
  const p3 = s.phases[2];
  if (p3 === 'closed') b1 |= 0x02;
  if (p3 === 'open') b1 |= 0x01;

  if (s.controlMode === 'local') b1 |= 0x04;
  return Uint8Array.from([b0, b1]);
}

/* ---------------------------------------------------------------- 协议表 */

export const PROFILES: Record<ProtocolId, ProtocolProfile> = {
  mg400: {
    id: 'mg400',
    label: 'MG400',
    commandBits: MG400_COMMAND_BITS,
    statusBits: MG400_STATUS_BITS,
    encodeStatus: encodeMg400Status,
    devices: ['ground', 'ice', 'lock', 'phase1', 'phase2', 'activation'],
    maxPhases: 2,
    hasActivation: true,
  },
  mg500: {
    id: 'mg500',
    label: 'MG500',
    commandBits: MG500_COMMAND_BITS,
    statusBits: MG500_STATUS_BITS,
    encodeStatus: encodeMg500Status,
    devices: ['ground', 'ground2', 'ice', 'lock', 'phase1', 'phase2', 'phase3'],
    maxPhases: 3,
    hasActivation: false,
  },
};

export function getProfile(id?: string | null): ProtocolProfile {
  return id === 'mg500' ? PROFILES.mg500 : PROFILES.mg400;
}

/* ---------------------------------------------------------------- 解码 */

export interface CommandAction {
  slot: DeviceSlot;
  kind: CommandKind;
  label: string;
}

export function decodeCommand(
  data: Uint8Array,
  profile: ProtocolProfile = PROFILES.mg400,
): {
  actions: CommandAction[];
  reserved: number;
  allZero: boolean;
} {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  const actions: CommandAction[] = [];
  for (const def of profile.commandBits) {
    if (!def.slot || def.slot === 'spare' || !def.kind) continue;
    const byteVal = def.byte === 0 ? b0 : b1;
    if (byteVal & (1 << def.bit)) {
      actions.push({ slot: def.slot, kind: def.kind, label: def.label });
    }
  }
  return { actions, reserved: b0 & 0xf0, allZero: b0 === 0 && b1 === 0 };
}

export function encodeCommand(
  actions: Array<{ slot: DeviceSlot; kind: CommandKind }>,
  profile: ProtocolProfile = PROFILES.mg400,
): Uint8Array {
  let b0 = 0;
  let b1 = 0;
  for (const a of actions) {
    const def = profile.commandBits.find((d) => d.slot === a.slot && d.kind === a.kind);
    if (!def) continue;
    if (def.byte === 0) b0 |= 1 << def.bit;
    else b1 |= 1 << def.bit;
  }
  return Uint8Array.from([b0, b1]);
}

export function statusBitsOf(
  data: Uint8Array,
  profile: ProtocolProfile = PROFILES.mg400,
): Array<{ bit: number; on: boolean; label: string }> {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  return profile.statusBits.map((def) => ({
    bit: def.byte === 0 ? 8 + def.bit : def.bit,
    on: (((def.byte === 0 ? b0 : b1) >> def.bit) & 1) === 1,
    label: def.label,
  }));
}

export function commandBitsOf(
  data: Uint8Array,
  profile: ProtocolProfile = PROFILES.mg400,
): Array<{ bit: number; on: boolean; label: string }> {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  return profile.commandBits.map((def) => ({
    bit: def.byte === 0 ? 8 + def.bit : def.bit,
    on: (((def.byte === 0 ? b0 : b1) >> def.bit) & 1) === 1,
    label: def.label,
  }));
}

export function describeStatus(data: Uint8Array, profile: ProtocolProfile = PROFILES.mg400): string[] {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  const out: string[] = [];
  if (profile.id === 'mg500') {
    out.push(b0 & 0x80 ? '光纤链路' : '4G 链路');
    if (b0 & 0x40) out.push('接地刀闸2合');
    if (b0 & 0x20) out.push('接地刀闸2分');
  } else if (b0 & 0x20) {
    out.push('网络错误');
  }
  if (b0 & 0x01) out.push('接地刀闸合');
  if (b1 & 0x80) out.push('接地刀闸分');
  if (b0 & 0x10) out.push('融冰刀闸合');
  if (b0 & 0x08) out.push('融冰刀闸分');
  if (b0 & 0x04) out.push('融冰锁闭锁');
  if (b0 & 0x02) out.push('融冰锁开锁');
  if (b1 & 0x40) out.push('选相1合');
  if (b1 & 0x20) out.push('选相1分');
  if (b1 & 0x10) out.push('选相2合');
  if (b1 & 0x08) out.push('选相2分');
  out.push(b1 & 0x04 ? '控制模式本地' : '控制模式远程');
  if (profile.id === 'mg500') {
    if (b1 & 0x02) out.push('选相3合');
    if (b1 & 0x01) out.push('选相3分');
  } else {
    out.push(`电量档 ${b1 & 0x03}`);
  }
  return out.filter(Boolean);
}

/** 初始态（最左一列）：接地合、选相分、锁闭锁、融冰分、活化关 */
export function defaultStates(phaseCount: number): Record<string, string> {
  const states: Record<string, string> = {
    ground: 'closed',
    ground2: 'closed',
    ice: 'open',
    lock: 'locked',
    activation: 'off',
  };
  for (let i = 1; i <= Math.max(phaseCount, 0); i++) states[`phase${i}`] = 'open';
  return states;
}

/* 兼容旧引用（MG400） */
export const COMMAND_BITS = MG400_COMMAND_BITS;
export const STATUS_BITS = MG400_STATUS_BITS;
export const encodeStatus = encodeMg400Status;
