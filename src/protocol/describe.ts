import { FRAME_DIR, FRAME_NAMES, FT, sideOf, toHexUpper, type DecodedFrame } from './frame';
import { commandBitsOf, decodeCommand, describeStatus, getProfile, statusBitsOf, type ProtocolId } from './bits';
import { decodeEnvFields, decodePowerFields, summarizePower, type FieldRow } from './power';

export interface ParsedFrame {
  id: number;
  idLabel: string;
  type: number;
  typeName: string;
  direction: 'tx' | 'rx';
  known: boolean;
  summary: string;
  fields: FieldRow[];
  bits: Array<{ bit: number; on: boolean; label: string }>;
  crcOk: boolean;
  crcCalc: string;
  crcRecv: string;
  dataHex: string;
  dataLen: number;
  rawHex: string;
}

export function describe(frame: DecodedFrame, protocol: ProtocolId = 'mg400'): ParsedFrame {
  const profile = getProfile(protocol);
  const typeName = FRAME_NAMES[frame.type];
  const known = typeName !== undefined;
  const direction = FRAME_DIR[frame.type] ?? 'rx';
  const base: ParsedFrame = {
    id: frame.id,
    idLabel: `${frame.id}（0x${frame.id.toString(16).padStart(4, '0')}·${sideOf(frame.id)}）`,
    type: frame.type,
    typeName: typeName ?? '未定义帧类型',
    direction,
    known,
    summary: '',
    fields: [],
    bits: [],
    crcOk: frame.crcOk,
    crcCalc: hex16(frame.crcCalc),
    crcRecv: hex16(frame.crcRecv),
    dataHex: toHexUpper(frame.data),
    dataLen: frame.data.length,
    rawHex: toHexUpper(frame.raw),
  };

  switch (frame.type) {
    case FT.CMD: {
      const { actions, reserved } = decodeCommand(frame.data, profile);
      base.bits = commandBitsOf(frame.data, profile);
      base.summary = actions.length
        ? `动作命令：${actions.map((a) => a.label).join(' + ')}`
        : '动作命令：无有效动作位';
      base.fields = actions.map((a) => ({ label: '动作', value: a.label }));
      if (reserved) base.fields.push({ label: '保留位', value: `高字节 0x${reserved.toString(16)} 置位`, note: '协议未定义' });
      if (frame.data.length !== 2) base.fields.push({ label: '长度异常', value: `期望 2 字节，实际 ${frame.data.length} 字节` });
      break;
    }
    case FT.DI: {
      base.bits = statusBitsOf(frame.data, profile);
      base.summary = `DI 状态：${describeStatus(frame.data, profile).join(' / ')}`;
      base.fields = [{ label: '状态', value: describeStatus(frame.data, profile).join('，') }];
      if (profile.id === 'mg400') {
        base.fields.push({ label: '电量档', value: `${(frame.data[1] ?? 0) & 0x03}（对应 0/25/50/75%）` });
      }
      break;
    }
    case FT.POWER: {
      base.summary = `供电状态：${summarizePower(frame.data)}`;
      base.fields = decodePowerFields(frame.data);
      break;
    }
    case FT.ENV: {
      base.summary = '环境状态（本期终端不上报，仅解析）';
      base.fields = decodeEnvFields(frame.data);
      break;
    }
    case FT.CMD_ACK:
    case FT.HEARTBEAT:
    case FT.POWER_ACK:
    case FT.ENV_ACK: {
      const code = frame.data[0] ?? 0;
      base.summary = code === 0 ? `${typeName}（0x00 正常/心跳）` : `${typeName}（码 0x${code.toString(16)}）`;
      base.fields = [{ label: '应答码', value: `0x${code.toString(16).padStart(2, '0')}` }];
      break;
    }
    case FT.REGISTER: {
      base.summary = `上线注册（数据 ${toHexUpper(frame.data)}，协议文档未定义，按约定 FFFF 为注册）`;
      base.fields = [{ label: '注册数据', value: toHexUpper(frame.data) }];
      break;
    }
    case FT.AC_CMD: {
      const v = frame.data[0] ?? 0;
      base.summary = `空调命令：${v === 1 ? '打开' : v === 0 ? '关闭' : `未知值 ${v}`}`;
      base.fields = [{ label: '命令', value: v === 1 ? '打开空调' : v === 0 ? '关闭空调' : String(v) }];
      break;
    }
    case FT.AC_ACK: {
      base.summary = '空调命令响应（本期不处理）';
      base.fields = [{ label: '应答码', value: `0x${(frame.data[0] ?? 0).toString(16).padStart(2, '0')}` }];
      break;
    }
    default: {
      base.summary = `未定义帧类型 0x${frame.type.toString(16).padStart(2, '0')}，数据 ${frame.data.length} 字节`;
      base.fields = Array.from(frame.data).map((byte, i) => {
        const bin = byte.toString(2).padStart(8, '0');
        return {
          label: `Byte ${i}`,
          value: `0x${byte.toString(16).padStart(2, '0')}  b7..b0 = ${bin.slice(0, 4)} ${bin.slice(4)}`,
        };
      });
      break;
    }
  }

  if (!frame.crcOk) {
    base.fields.push({
      label: 'CRC 校验失败',
      value: `计算 ${base.crcCalc} / 实际 ${base.crcRecv}`,
      note: '平台可能不校验 CRC，仅提示',
    });
  }
  return base;
}

function hex16(v: number): string {
  const hi = (v >> 8) & 0xff;
  const lo = v & 0xff;
  return `${lo.toString(16).padStart(2, '0').toUpperCase()} ${hi.toString(16).padStart(2, '0').toUpperCase()}`;
}
