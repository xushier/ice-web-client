#!/usr/bin/env node
/**
 * 本地「假平台」：模拟 MG400 操作平台，用于没有真实平台时全流程自测。
 *
 *   node tools/mock-platform.mjs --port 4000
 *
 * 键盘指令（发往所有已连接终端）：
 *   g 接地刀闸分闸    G 接地刀闸合闸
 *   i 融冰刀闸分闸    I 融冰刀闸合闸
 *   l 融冰锁闭锁      L 融冰锁开锁
 *   j 选相1分闸       k 选相1合闸
 *   q 退出
 */
import net from 'node:net';
import readline from 'node:readline';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 4000;

const NAMES = {
  0x00: '远端操作命令',
  0x01: '命令响应',
  0x02: '空调命令',
  0x03: '空调响应',
  0x05: '上线注册',
  0x10: 'DI 状态',
  0x11: '心跳应答',
  0x20: '供电状态',
  0x21: '供电应答',
  0x30: '环境状态',
  0x31: '环境应答',
};

const hex = (b) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(' ')
    .toUpperCase();

function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

function build(id, type, data = []) {
  const buf = Buffer.alloc(8 + data.length);
  buf[0] = 0x5a;
  buf[1] = 0x47;
  buf[2] = 3 + data.length;
  buf.writeUInt16BE(id, 3);
  buf[5] = type;
  Buffer.from(data).copy(buf, 6);
  const crc = crc16(buf.subarray(0, 6 + data.length));
  buf[6 + data.length] = crc & 0xff;
  buf[7 + data.length] = (crc >> 8) & 0xff;
  return buf;
}

function summarize(type, d) {
  if (type === 0x10) {
    const [b0, b1] = d;
    const on = [];
    if (b0 & 0x01) on.push('接地合');
    if (b1 & 0x80) on.push('接地分');
    if (b0 & 0x10) on.push('融冰合');
    if (b0 & 0x08) on.push('融冰分');
    if (b0 & 0x04) on.push('闭锁');
    if (b0 & 0x02) on.push('开锁');
    if (b1 & 0x40) on.push('选相1合');
    if (b1 & 0x20) on.push('选相1分');
    if (b1 & 0x04) on.push('本地');
    return `${on.join(' / ')} | 电量档 ${b1 & 0x03}`;
  }
  if (type === 0x20) {
    const u16 = (i) => (d[i] << 8) | d[i + 1];
    return `电量 ${u16(0)}% · 电池 ${(u16(2) / 10).toFixed(1)}V · 光伏 ${(u16(8) / 10).toFixed(1)}V`;
  }
  return hex(d);
}

const sockets = new Set();

const server = net.createServer((sock) => {
  const peer = `${sock.remoteAddress}:${sock.remotePort}`;
  let buf = Buffer.alloc(0);
  console.log(`\n[+] 终端接入 ${peer}`);
  sockets.add(sock);

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const idx = buf.indexOf(Buffer.from([0x5a, 0x47]));
      if (idx < 0) {
        buf = buf.subarray(Math.max(0, buf.length - 1));
        break;
      }
      if (idx > 0) buf = buf.subarray(idx);
      if (buf.length < 3) break;
      const total = 3 + buf[2] + 2;
      if (buf.length < total) break;
      const raw = buf.subarray(0, total);
      buf = buf.subarray(total);

      const id = raw.readUInt16BE(3);
      const type = raw[5];
      const data = raw.subarray(6, 6 + raw[2] - 3);
      sock.mockId = id;
      console.log(
        `  ← #${id} 0x${type.toString(16).padStart(2, '0')} ${NAMES[type] ?? '未定义'} : ${summarize(type, data)}`,
      );
      // 平台实际行为：收到任何帧都回一次心跳应答
      sock.write(build(id, 0x11, [0x00]));
    }
  });

  sock.on('close', () => {
    sockets.delete(sock);
    console.log(`[-] 终端断开 ${peer}`);
  });
  sock.on('error', () => {});
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[mock-platform] listening on :${port}`);
  console.log('键盘：g/G 接地分/合 · i/I 融冰分/合 · l/L 锁闭/开 · j/k 选相1分/合 · q 退出');
});

function broadcast(data) {
  if (!sockets.size) {
    console.log('  (没有已连接的终端)');
    return;
  }
  for (const s of sockets) {
    const frame = build(s.mockId ?? 0x000d, 0x00, data);
    s.write(frame);
    console.log(`  → #${s.mockId ?? 0x000d} ${hex(frame)}`);
  }
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
  if (key?.ctrl && key.name === 'c') process.exit(0);
  switch (str) {
    case 'g': broadcast([0x00, 0x40]); break;
    case 'G': broadcast([0x00, 0x80]); break;
    case 'i': broadcast([0x08, 0x00]); break;
    case 'I': broadcast([0x10, 0x00]); break;
    case 'l': broadcast([0x02, 0x00]); break;
    case 'L': broadcast([0x01, 0x00]); break;
    case 'j': broadcast([0x00, 0x10]); break;
    case 'k': broadcast([0x00, 0x20]); break;
    case 'q': process.exit(0); break;
    default: break;
  }
});
