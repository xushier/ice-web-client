export interface PowerTelemetry {
  batteryPercent: number;
  batteryVoltage: number;
  loadVoltage: number;
  loadCurrent: number;
  pvVoltage: number;
  pvCurrent: number;
}

export interface FieldRow {
  label: string;
  value: string;
  note?: string;
}

function u16(out: Uint8Array, offset: number, value: number): void {
  const v = Math.max(0, Math.min(0xffff, Math.round(value)));
  out[offset] = (v >> 8) & 0xff;
  out[offset + 1] = v & 0xff;
}

function rU16(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function rI16(data: Uint8Array, offset: number): number {
  const v = rU16(data, offset);
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** 0x20 直流供电状态：18 字节，16 位无符号数，高字节先发 */
export function encodePower(t: PowerTelemetry): Uint8Array {
  const out = new Uint8Array(18);
  u16(out, 0, t.batteryPercent);
  u16(out, 2, t.batteryVoltage * 10);
  u16(out, 4, t.loadVoltage * 10);
  u16(out, 6, t.loadCurrent * 100);
  u16(out, 8, t.pvVoltage * 10);
  u16(out, 10, t.pvCurrent * 100);
  u16(out, 12, 0);
  u16(out, 14, 0);
  u16(out, 16, 0);
  return out;
}

export function decodePowerFields(data: Uint8Array): FieldRow[] {
  const rows: FieldRow[] = [
    { label: '锂电池剩余电量', value: `${rU16(data, 0)} %` },
    { label: '锂电池电压', value: `${(rU16(data, 2) / 10).toFixed(1)} V` },
    { label: '负载电压', value: `${(rU16(data, 4) / 10).toFixed(1)} V` },
    { label: '负载电流', value: `${(rU16(data, 6) / 100).toFixed(2)} A` },
    { label: '太阳能板电压', value: `${(rU16(data, 8) / 10).toFixed(1)} V` },
    { label: '太阳能板充电电流', value: `${(rU16(data, 10) / 100).toFixed(2)} A` },
    { label: '负载/充电状态', value: `0x${rU16(data, 12).toString(16).padStart(4, '0')}`, note: '保存不显示' },
    { label: '故障信息高 16 位', value: `0x${rU16(data, 14).toString(16).padStart(4, '0')}`, note: '保存不显示' },
    { label: '故障信息低 16 位', value: `0x${rU16(data, 16).toString(16).padStart(4, '0')}`, note: '保存不显示' },
  ];
  return rows;
}

export function summarizePower(data: Uint8Array): string {
  return `电量 ${rU16(data, 0)}% · 电池 ${(rU16(data, 2) / 10).toFixed(1)}V · 负载 ${(rU16(data, 4) / 10).toFixed(1)}V/${(rU16(data, 6) / 100).toFixed(2)}A · 光伏 ${(rU16(data, 8) / 10).toFixed(1)}V/${(rU16(data, 10) / 100).toFixed(2)}A`;
}

const AC_STATUS = ['未通电', '待机', '运行', '故障'];

/** 0x30 环境状态：16 字节（本期不上报，仅解析展示） */
export function decodeEnvFields(data: Uint8Array): FieldRow[] {
  const ac = rU16(data, 8);
  const alarmLo = rU16(data, 10);
  const alarmHi = data[12] ?? 0;
  const fire = data[13] ?? 0;
  return [
    { label: '机柜内温度', value: `${(rI16(data, 0) / 10).toFixed(1)} ℃` },
    { label: '机柜内湿度', value: `${(rU16(data, 2) / 10).toFixed(1)} %RH` },
    { label: '电池舱 1 温度', value: `${(rI16(data, 4) / 10).toFixed(1)} ℃` },
    { label: '电池舱 2 温度', value: `${(rI16(data, 6) / 10).toFixed(1)} ℃` },
    { label: '空调状态', value: `${ac} · ${AC_STATUS[ac] ?? '未知'}` },
    { label: '空调告警 1~16', value: `0x${alarmLo.toString(16).padStart(4, '0')}` },
    { label: '空调告警 17', value: `${alarmHi & 1}` },
    { label: '灭火装置状态', value: fire ? `已用 0x${fire.toString(16)}` : '待用' },
    { label: '保留', value: `0x${rU16(data, 14).toString(16).padStart(4, '0')}` },
  ];
}
