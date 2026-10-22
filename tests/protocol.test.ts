import { describe, expect, it } from 'vitest';
import { crc16Modbus } from '../src/protocol/crc';
import { FrameDecoder, decodeFrame, encodeFrame, parseHex, toHex } from '../src/protocol/frame';
import { decodeCommand, encodeCommand, encodeStatus, coarseBattery, defaultStates, type StatusSnapshot } from '../src/protocol/bits';
import { deviceButtons, orderDevices } from '../src/core/types';
import { encodePower } from '../src/protocol/power';
import { describe as describeFrame } from '../src/protocol/describe';

const DEFAULT_STATUS: StatusSnapshot = {
  ground: 'closed',
  ice: 'open',
  lock: 'locked',
  phases: ['closed', 'closed'],
  controlMode: 'remote',
  networkError: false,
  batteryPercent: 62,
  activation: 'off',
};

describe('CRC-16/MODBUS', () => {
  it('文档示例帧的 CRC 应为 E0 F8（文档写的 0A 0B 是错的）', () => {
    const frame = parseHex('5a4705000c05ffff');
    const crc = crc16Modbus(frame);
    expect(crc & 0xff).toBe(0xe0);
    expect((crc >> 8) & 0xff).toBe(0xf8);
  });
});

describe('组帧', () => {
  it('0x05 上线注册（ID 12）', () => {
    const buf = encodeFrame({ id: 12, type: 0x05, data: [0xff, 0xff] });
    expect(toHex(buf)).toBe('5a 47 05 00 0c 05 ff ff e0 f8');
  });

  it('0x10 默认状态（ID 13）', () => {
    const buf = encodeFrame({ id: 13, type: 0x10, data: encodeStatus(DEFAULT_STATUS) });
    expect(toHex(buf)).toBe('5a 47 05 00 0d 10 0d 51 34 1c');
  });

  it('0x01 命令应答（ID 13）', () => {
    const buf = encodeFrame({ id: 13, type: 0x01, data: [0x00] });
    expect(toHex(buf)).toBe('5a 47 04 00 0d 01 00 8f e1');
  });

  it('长度字段 = 3 + 数据区长度', () => {
    const buf = encodeFrame({ id: 1, type: 0x20, data: new Uint8Array(18) });
    expect(buf[2]).toBe(21);
    expect(buf.length).toBe(26);
  });

  it('数据区超长应抛错', () => {
    expect(() => encodeFrame({ id: 1, type: 0x20, data: new Uint8Array(300) })).toThrow();
  });
});

describe('拆帧', () => {
  it('粘包：一次推入两帧', () => {
    const a = encodeFrame({ id: 13, type: 0x10, data: encodeStatus(DEFAULT_STATUS) });
    const b = encodeFrame({ id: 13, type: 0x11, data: [0x00] });
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    const frames = new FrameDecoder().push(merged);
    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe(0x10);
    expect(frames[1].type).toBe(0x11);
  });

  it('半包：分两次推入', () => {
    const buf = encodeFrame({ id: 13, type: 0x10, data: encodeStatus(DEFAULT_STATUS) });
    const decoder = new FrameDecoder();
    expect(decoder.push(buf.slice(0, 4))).toHaveLength(0);
    const frames = decoder.push(buf.slice(4));
    expect(frames).toHaveLength(1);
    expect(frames[0].crcOk).toBe(true);
  });

  it('噪声字节后仍能同步', () => {
    const buf = encodeFrame({ id: 11, type: 0x00, data: [0x00, 0x40] });
    const noisy = new Uint8Array(buf.length + 3);
    noisy.set([0xff, 0x00, 0x13], 0);
    noisy.set(buf, 3);
    const frames = new FrameDecoder().push(noisy);
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe(11);
  });

  it('CRC 错误被标记但不丢帧', () => {
    const buf = encodeFrame({ id: 13, type: 0x10, data: [0x0d, 0x52], crcMode: 'zero' });
    const frames = new FrameDecoder().push(buf);
    expect(frames).toHaveLength(1);
    expect(frames[0].crcOk).toBe(false);
  });

  it('ID 解析保留大小号侧 bit0', () => {
    const frames = new FrameDecoder().push(encodeFrame({ id: 13, type: 0x11, data: [0] }));
    expect(frames[0].id).toBe(13);
    expect(describeFrame(frames[0]).idLabel).toContain('大号侧');
    const even = new FrameDecoder().push(encodeFrame({ id: 12, type: 0x11, data: [0] }));
    expect(describeFrame(even[0]).idLabel).toContain('小号侧');
  });
});

describe('0x00 命令解析', () => {
  it('接地刀闸分闸（Byte1 b6）', () => {
    const { actions } = decodeCommand(Uint8Array.from([0x00, 0x40]));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ slot: 'ground', kind: 'open' });
  });

  it('一帧多动作', () => {
    const { actions } = decodeCommand(Uint8Array.from([0x08, 0x80]));
    expect(actions.map((a) => `${a.slot}:${a.kind}`)).toEqual(['ice:close', 'ground:close']);
  });

  it('同一设备合分同时置位仍解析出两位（由上层判冲突）', () => {
    const { actions } = decodeCommand(Uint8Array.from([0x0c, 0x00]));
    expect(actions).toHaveLength(2);
  });

  it('高位保留位置位时记录', () => {
    const { actions, reserved } = decodeCommand(Uint8Array.from([0x80, 0x00]));
    expect(actions).toHaveLength(0);
    expect(reserved).toBe(0x80);
  });

  it('encodeCommand 与 decodeCommand 互逆', () => {
    const bytes = encodeCommand([
      { slot: 'ground', kind: 'open' },
      { slot: 'ice', kind: 'close' },
      { slot: 'lock', kind: 'unlock' },
      { slot: 'phase2', kind: 'open' },
    ]);
    const { actions } = decodeCommand(bytes);
    expect(actions.map((a) => `${a.slot}:${a.kind}`).sort()).toEqual(
      ['ground:open', 'ice:close', 'lock:unlock', 'phase2:open'].sort(),
    );
  });
});

describe('0x10 状态编码', () => {
  it('状态位与协议表一致', () => {
    const [b0, b1] = encodeStatus(DEFAULT_STATUS);
    expect(b0 & 0x01).toBe(0x01); // 接地合
    expect(b0 & 0x08).toBe(0x08); // 融冰分
    expect(b0 & 0x04).toBe(0x04); // 闭锁
    expect(b1 & 0x40).toBe(0x40); // 选相1合
    expect(b1 & 0x10).toBe(0x10); // 选相2合
  });

  it('接地刀闸分闸置 Byte1 b7，而不是 Byte0 b0', () => {
    const [b0, b1] = encodeStatus({ ...DEFAULT_STATUS, ground: 'open' });
    expect(b1 & 0x80).toBe(0x80);
    expect(b0 & 0x01).toBe(0x00);
  });

  it('开锁状态置 Byte0 b1 且清除 b2', () => {
    const [b0] = encodeStatus({ ...DEFAULT_STATUS, lock: 'unlocked' });
    expect(b0 & 0x02).toBe(0x02);
    expect(b0 & 0x04).toBe(0x00);
  });

  it('本地模式置 Byte1 b2', () => {
    const [, b1] = encodeStatus({ ...DEFAULT_STATUS, controlMode: 'local' });
    expect(b1 & 0x04).toBe(0x04);
  });

  it('电量档映射 0/25/50/75', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(coarseBattery)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('活化状态占低字节 b1（默认），开=1 关=0', () => {
    const [, on] = encodeStatus({ ...DEFAULT_STATUS, activation: 'on' });
    expect(on & 0x02).toBe(0x02);
    const [, off] = encodeStatus({ ...DEFAULT_STATUS, activation: 'off' });
    expect(off & 0x02).toBe(0x00);
  });

  it('活化改到 b0 时 b1 让给电量档', () => {
    const [, on] = encodeStatus({ ...DEFAULT_STATUS, activation: 'on', activationBit: 'b0' });
    expect(on & 0x01).toBe(0x01);
    expect(on & 0x02).toBe(0x02); // 电量 62% ≥ 50%，占 b1
  });

  it('none 模式保留 4 档电量', () => {
    const [, v] = encodeStatus({ ...DEFAULT_STATUS, activation: 'on', activationBit: 'none' });
    expect(v & 0x03).toBe(2); // 62% → 档 2
  });
});

describe('0x20 供电帧', () => {
  it('字段编码正确', () => {
    const data = encodePower({
      batteryPercent: 62,
      batteryVoltage: 47.3,
      loadVoltage: 47.1,
      loadCurrent: 0.52,
      pvVoltage: 55.1,
      pvCurrent: 1.2,
    });
    expect(data).toHaveLength(18);
    expect(data[1]).toBe(62);
    expect((data[2] << 8) | data[3]).toBe(473);
    expect((data[6] << 8) | data[7]).toBe(52);
    expect((data[8] << 8) | data[9]).toBe(551);
    expect((data[10] << 8) | data[11]).toBe(120);
  });

  it('解码回读一致', () => {
    const data = encodePower({
      batteryPercent: 88,
      batteryVoltage: 52.7,
      loadVoltage: 52.5,
      loadCurrent: 0.77,
      pvVoltage: 79,
      pvCurrent: 2.99,
    });
    const frame = decodeFrame(encodeFrame({ id: 13, type: 0x20, data }));
    const parsed = describeFrame(frame);
    expect(parsed.summary).toContain('电量 88%');
    expect(parsed.summary).toContain('52.7V');
  });
});

describe('未知帧类型', () => {
  it('不抛错并给出原始字节展开', () => {
    const frame = decodeFrame(encodeFrame({ id: 13, type: 0x77, data: [0xde, 0xad] }));
    const parsed = describeFrame(frame);
    expect(parsed.known).toBe(false);
    expect(parsed.summary).toContain('未定义帧类型 0x77');
    expect(parsed.fields).toHaveLength(2);
  });
});

describe('电池活化指令', () => {
  it('活化开 = 数据区 00 02（与现场 5A470500010000027224 一致）', () => {
    const { actions, allZero } = decodeCommand(Uint8Array.from([0x00, 0x02]));
    expect(allZero).toBe(false);
    expect(actions.map((a) => `${a.slot}:${a.kind}`)).toEqual(['activation:on']);
  });

  it('活化关 = 数据区全 0（与现场 5A47050001000000F3E5 一致）', () => {
    const { actions, allZero } = decodeCommand(Uint8Array.from([0x00, 0x00]));
    expect(actions).toHaveLength(0);
    expect(allZero).toBe(true);
  });

  it('生成器里的活化帧 CRC 校验通过', () => {
    const on = decodeFrame(parseHex('5A470500010000027224'));
    expect(on.crcOk).toBe(true);
    expect([...on.data]).toEqual([0x00, 0x02]);
    const off = decodeFrame(parseHex('5A47050001000000F3E5'));
    expect(off.crcOk).toBe(true);
    expect([...off.data]).toEqual([0x00, 0x00]);
  });
});

describe('动作中状态', () => {
  it('动作中在 0x10 里两位都为 0', () => {
    const [b0, b1] = encodeStatus({
      ...DEFAULT_STATUS,
      ground: 'opening',
      ice: 'closing',
      lock: 'unlocking',
      phases: ['opening', 'closing'],
    });
    expect(b0 & 0x01).toBe(0);
    expect(b1 & 0x80).toBe(0);
    expect(b0 & 0x18).toBe(0);
    expect(b0 & 0x06).toBe(0);
    expect(b1 & 0x78).toBe(0);
  });

  it('到位后对应位置 1', () => {
    const [b0] = encodeStatus({ ...DEFAULT_STATUS, lock: 'unlocked' });
    expect(b0 & 0x02).toBe(0x02);
  });
});

describe('默认状态与设备顺序', () => {
  it('默认初始态：接地合、选相分、锁闭锁、融冰分、活化关', () => {
    expect(defaultStates(2)).toEqual({
      ground: 'closed',
      ice: 'open',
      lock: 'locked',
      activation: 'off',
      phase1: 'open',
      phase2: 'open',
    });
  });

  it('默认排序：接地 → 选相 → 融冰锁 → 融冰 → 活化', () => {
    expect(orderDevices(['ice', 'lock', 'phase2', 'ground', 'activation', 'phase1'])).toEqual([
      'ground',
      'phase1',
      'phase2',
      'lock',
      'ice',
      'activation',
    ]);
  });

  it('三列按钮：左初始态、中动作中、右融冰态', () => {
    expect(deviceButtons('ground', 'closed').map((b) => b.value)).toEqual(['closed', 'opening', 'open']);
    expect(deviceButtons('ground', 'open').map((b) => b.label)).toEqual(['合闸到位', '合闸中', '分闸到位']);
    expect(deviceButtons('ice', 'open').map((b) => b.value)).toEqual(['open', 'closing', 'closed']);
    expect(deviceButtons('lock', 'locked').map((b) => b.label)).toEqual(['闭锁到位', '开锁中', '开锁到位']);
    expect(deviceButtons('phase1', 'closed').map((b) => b.label)).toEqual(['分闸到位', '分闸中', '合闸到位']);
    expect(deviceButtons('activation', 'off').map((b) => b.label)).toEqual(['活化关闭', '活化开启']);
  });
});
