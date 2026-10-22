/**
 * CRC-16/MODBUS：多项式 0xA001（反射），初值 0xFFFF，无最终异或。
 * 协议要求从帧头开始计算，校验值低字节在前。
 */
export function crc16Modbus(buf: Uint8Array, start = 0, end = buf.length): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}
