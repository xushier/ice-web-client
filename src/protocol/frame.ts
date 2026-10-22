import { crc16Modbus } from './crc';

export const HEAD = [0x5a, 0x47] as const;
/** 帧头 2 + 长度 1 + ID 2 + 类型 1 + 数据 n + CRC 2 */
export const FRAME_OVERHEAD = 8;
export const MAX_DATA = 247;

export const FT = {
  CMD: 0x00,
  CMD_ACK: 0x01,
  AC_CMD: 0x02,
  AC_ACK: 0x03,
  REGISTER: 0x05,
  DI: 0x10,
  HEARTBEAT: 0x11,
  POWER: 0x20,
  POWER_ACK: 0x21,
  ENV: 0x30,
  ENV_ACK: 0x31,
} as const;

export const FRAME_NAMES: Record<number, string> = {
  0x00: '远端操作命令',
  0x01: '主控执行命令响应',
  0x02: '空调开关命令',
  0x03: '空调命令响应',
  0x05: '上线注册（未在协议文档中定义）',
  0x10: 'DI 设备状态',
  0x11: '心跳应答',
  0x20: '直流供电状态',
  0x21: '供电状态应答',
  0x30: '环境状态',
  0x31: '环境状态应答',
};

/** 方向（以终端为主控视角）：tx = 终端发往平台，rx = 平台发给终端 */
export const FRAME_DIR: Record<number, 'tx' | 'rx'> = {
  0x00: 'rx',
  0x01: 'tx',
  0x02: 'rx',
  0x03: 'tx',
  0x05: 'tx',
  0x10: 'tx',
  0x11: 'rx',
  0x20: 'tx',
  0x21: 'rx',
  0x30: 'tx',
  0x31: 'rx',
};

export type CrcMode = 'auto' | 'zero' | 'fixed';

export interface DecodedFrame {
  id: number;
  type: number;
  data: Uint8Array;
  raw: Uint8Array;
  crcCalc: number;
  crcRecv: number;
  crcOk: boolean;
}

/** 组帧。id 为 12bit 字段原值（bit0 即大小号侧）。 */
export function encodeFrame(opts: {
  id: number;
  type: number;
  data?: ArrayLike<number>;
  crcMode?: CrcMode;
  fixedCrc?: number;
}): Uint8Array {
  const data = opts.data ? Uint8Array.from(opts.data as ArrayLike<number>) : new Uint8Array(0);
  if (data.length > MAX_DATA) throw new Error(`数据区过长：${data.length} > ${MAX_DATA}`);
  const buf = new Uint8Array(FRAME_OVERHEAD + data.length);
  buf[0] = HEAD[0];
  buf[1] = HEAD[1];
  buf[2] = 3 + data.length;
  buf[3] = (opts.id >> 8) & 0x0f;
  buf[4] = opts.id & 0xff;
  buf[5] = opts.type & 0xff;
  buf.set(data, 6);
  const end = 6 + data.length;
  let crc: number;
  if (opts.crcMode === 'zero') crc = 0;
  else if (opts.crcMode === 'fixed') crc = opts.fixedCrc ?? 0;
  else crc = crc16Modbus(buf, 0, end);
  buf[end] = crc & 0xff;
  buf[end + 1] = (crc >> 8) & 0xff;
  return buf;
}

/** 流式拆帧：容忍粘包、半包、噪声字节，并自动重新同步帧头。 */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);
  public skippedBytes = 0;

  push(chunk: Uint8Array): DecodedFrame[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const out: DecodedFrame[] = [];
    for (;;) {
      const head = this.findHead();
      if (head < 0) {
        // 保留最后一个字节，避免把跨包帧头切断
        if (this.buf.length > 1) {
          this.skippedBytes += this.buf.length - 1;
          this.buf = this.buf.slice(this.buf.length - 1);
        }
        break;
      }
      if (head > 0) {
        this.skippedBytes += head;
        this.buf = this.buf.slice(head);
      }
      if (this.buf.length < 3) break;
      const len = this.buf[2];
      if (len < 3 || len > 3 + MAX_DATA) {
        this.skippedBytes += 1;
        this.buf = this.buf.slice(1);
        continue;
      }
      const total = 3 + len + 2;
      if (this.buf.length < total) break;
      const raw = this.buf.slice(0, total);
      this.buf = this.buf.slice(total);
      out.push(decodeFrame(raw));
    }
    return out;
  }

  get pending(): number {
    return this.buf.length;
  }

  private findHead(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === HEAD[0] && this.buf[i + 1] === HEAD[1]) return i;
    }
    return -1;
  }
}

export function decodeFrame(raw: Uint8Array): DecodedFrame {
  const len = raw[2];
  const dataLen = len - 3;
  const data = raw.slice(6, 6 + dataLen);
  const crcCalc = crc16Modbus(raw, 0, 6 + dataLen);
  const crcRecv = raw[6 + dataLen] | (raw[7 + dataLen] << 8);
  return {
    id: ((raw[3] & 0x0f) << 8) | raw[4],
    type: raw[5],
    data,
    raw,
    crcCalc,
    crcRecv,
    crcOk: crcCalc === crcRecv,
  };
}

export function toHex(buf: Uint8Array, sep = ' '): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(sep);
}

export function toHexUpper(buf: Uint8Array, sep = ' '): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(sep);
}

export function parseHex(text: string): Uint8Array {
  const clean = text.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('hex 长度必须为偶数');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function sideOf(id: number): '大号侧' | '小号侧' {
  return id & 1 ? '大号侧' : '小号侧';
}
