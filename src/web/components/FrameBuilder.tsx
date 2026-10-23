import { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import type { ModuleSnapshot } from '@/core/types';
import { getProfile } from '@/protocol/bits';
import { decodeFrame, encodeFrame, parseHex, toHexUpper } from '@/protocol/frame';
import { describe } from '@/protocol/describe';
import { encodeEnv, encodePower } from '@/protocol/power';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import { Badge, Button, Dialog, Field, Input, Select, cn } from './ui';

interface BitDef {
  byte: 0 | 1;
  bit: number;
  label: string;
}

const TYPES: Array<{ value: number; label: string; dataLen: number }> = [
  { value: 0x00, label: '0x00 远端操作命令', dataLen: 2 },
  { value: 0x01, label: '0x01 命令响应', dataLen: 1 },
  { value: 0x05, label: '0x05 上线注册', dataLen: 2 },
  { value: 0x10, label: '0x10 DI 设备状态', dataLen: 2 },
  { value: 0x11, label: '0x11 心跳应答', dataLen: 1 },
  { value: 0x20, label: '0x20 直流供电状态', dataLen: 18 },
  { value: 0x30, label: '0x30 环境状态', dataLen: 16 },
  { value: -1, label: '自定义类型', dataLen: 0 },
];

export default function FrameBuilder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const modules = useStore((s) => s.state?.modules) ?? [];
  const run = useStore((s) => s.run);
  const toast = useStore((s) => s.toast);

  const [targetId, setTargetId] = useState('');
  const [type, setType] = useState(0x00);
  const [customType, setCustomType] = useState(0x77);
  const [rawMode, setRawMode] = useState(false);
  const [rawHex, setRawHex] = useState('');
  const [bits, setBits] = useState<Set<string>>(new Set());
  const [power, setPower] = useState({ percent: 62, voltage: 47.3, pv: 55.1, pvA: 1.2, load: 47.1, loadA: 0.52 });
  const [dataHex, setDataHex] = useState('00');

  const target = modules.find((m) => m.id === targetId) ?? modules[0] ?? null;
  const profile = getProfile(target?.protocol);

  useEffect(() => {
    if (!targetId && modules[0]) setTargetId(modules[0].id);
  }, [modules, targetId]);

  const effectiveType = type >= 0 ? type : customType;

  const computedData = useMemo(() => {
    if (rawMode) return null;
    if (type === 0x00 || type === 0x10) {
      let b0 = 0;
      let b1 = 0;
      for (const key of bits) {
        const [byte, bit] = key.split(':').map(Number);
        if (byte === 0) b0 |= 1 << bit;
        else b1 |= 1 << bit;
      }
      return [b0, b1];
    }
    if (type === 0x20) {
      return Array.from(
        encodePower({
          batteryPercent: power.percent,
          batteryVoltage: power.voltage,
          loadVoltage: power.load,
          loadCurrent: power.loadA,
          pvVoltage: power.pv,
          pvCurrent: power.pvA,
        }),
      );
    }
    if (type === 0x01 || type === 0x11) return [0x00];
    if (type === 0x05) return [0xff, 0xff];
    if (type === 0x30) return Array.from(encodeEnv(target?.telemetry ?? {}));
    return null;
  }, [rawMode, type, bits, power, target?.telemetry]);

  const preview = useMemo(() => {
    if (rawMode) return rawHex.trim() ? rawHex.toUpperCase() : '—';
    if (!target) return '—';
    try {
      const data = computedData ?? parseHex(dataHex);
      return toHexUpper(encodeFrame({ id: target.moduleId, type: effectiveType, data }));
    } catch {
      return '数据区 hex 不合法';
    }
  }, [rawMode, rawHex, target, computedData, dataHex, effectiveType]);

  const previewSummary = useMemo(() => {
    if (!preview || preview.length < 16) return '';
    try {
      return describe(decodeFrame(parseHex(preview))).summary;
    } catch {
      return '';
    }
  }, [preview]);

  const send = async () => {
    const mod = modules.find((m) => m.id === targetId) ?? modules[0];
    if (!mod) throw new Error('请先创建模块');
    if (rawMode) {
      await api.send(mod.id, { hex: rawHex });
    } else {
      const data = computedData ?? Array.from(parseHex(dataHex));
      await api.send(mod.id, { type: effectiveType, dataHex: toHexUpper(Uint8Array.from(data), '') });
    }
    toast('帧已发送，可在帧监视中查看');
  };

  const fillFromModule = (m: ModuleSnapshot) => {
    const p = getProfile(m.protocol);
    const data = p.encodeStatus({
      ground: (m.states.ground as 'open' | 'closed') ?? 'closed',
      ground2: m.states.ground2 as 'open' | 'closed' | undefined,
      ice: (m.states.ice as 'open' | 'closed') ?? 'open',
      lock: (m.states.lock as 'locked' | 'unlocked') ?? 'locked',
      phases: [
        (m.states.phase1 as 'open' | 'closed') ?? 'open',
        (m.states.phase2 as 'open' | 'closed') ?? 'open',
        (m.states.phase3 as 'open' | 'closed') ?? 'open',
      ],
      controlMode: m.telemetry.controlMode,
      networkError: m.telemetry.networkError,
      batteryPercent: m.telemetry.batteryPercent,
      linkType: m.telemetry.linkType,
    });
    const set = new Set<string>();
    for (const byteIdx of [0, 1]) {
      for (let bit = 0; bit < 8; bit++) if (data[byteIdx] & (1 << bit)) set.add(`${byteIdx}:${bit}`);
    }
    setType(0x10);
    setRawMode(false);
    setBits(set);
  };

  const toggleBit = (key: string) => {
    const next = new Set(bits);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setBits(next);
  };

  const defs: BitDef[] = type === 0x10 ? profile.statusBits : profile.commandBits;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="帧构造器"
      description="帧结构：5A47 | 长度(=3+数据区) | ID(2B, bit0=大小号侧) | 类型 | 数据 | CRC16-MODBUS(低字节在前)。"
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button variant="primary" onClick={() => void run(send)}>
            <Send className="size-3.5" />
            发送
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="目标模块">
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {modules.length === 0 ? <option value="">（无模块）</option> : null}
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.towerName} #{m.moduleId}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="帧类型">
          <Select
            value={type}
            onChange={(e) => {
              const v = Number(e.target.value);
              setType(v);
              setRawMode(false);
              setBits(new Set());
              if (v === 0x30) setDataHex('00'.repeat(16));
              else if (v === -1) setDataHex('dead');
            }}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="发送方式">
          <div className="flex h-8 items-center gap-2">
            <Button size="xs" variant={rawMode ? 'primary' : 'ghost'} onClick={() => setRawMode(true)}>
              整帧 hex
            </Button>
            <Button size="xs" variant={!rawMode ? 'primary' : 'ghost'} onClick={() => setRawMode(false)}>
              按协议构造
            </Button>
          </div>
        </Field>
      </div>

      {type === -1 && !rawMode ? (
        <div className="mt-3">
          <Field label="自定义帧类型（0~255）">
            <Input
              value={customType}
              inputMode="numeric"
              onChange={(e) => setCustomType(Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
            />
          </Field>
        </div>
      ) : null}

      {rawMode ? (
        <div className="mt-3">
          <Field label="完整帧 hex（含 5A 47 … CRC）" hint="服务端会原样发送，不做任何改写，适合复现未知帧。">
            <textarea
              className="h-24 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-[11px] outline-none focus:border-slate-500"
              value={rawHex}
              placeholder="5a 47 05 00 0d 10 0d 52 74 1d"
              onChange={(e) => setRawHex(e.target.value)}
            />
          </Field>
        </div>
      ) : null}

      {!rawMode && (type === 0x00 || type === 0x10) ? (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-400">快捷：</span>
            {type === 0x00
              ? profile.commandBits
                  .filter((d) => d.slot !== 'spare' && d.kind)
                  .map((d) => (
                    <Button
                      key={`${d.byte}:${d.bit}`}
                      size="xs"
                      variant="subtle"
                      onClick={() => setBits(new Set([`${d.byte}:${d.bit}`]))}
                    >
                      {d.label.replace('刀闸 ', '').replace(' 合闸', '合').replace(' 分闸', '分')}
                    </Button>
                  ))
              : null}
            {type === 0x00 && profile.hasActivation ? (
              <Button size="xs" variant="subtle" onClick={() => setBits(new Set())}>
                活化关(全0)
              </Button>
            ) : null}
            {type === 0x10 && target ? (
              <Button size="xs" variant="subtle" onClick={() => fillFromModule(target)}>
                用当前状态填充
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={() => setBits(new Set())}>
              清空
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {([0, 1] as const).map((byte) => (
              <div key={byte} className="rounded-lg border border-slate-200">
                <div className="border-b border-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">
                  {byte === 0 ? '高字节 Byte0' : '低字节 Byte1'}
                </div>
                <div className="divide-y divide-slate-50">
                  {defs
                    .filter((d) => d.byte === byte)
                    .sort((a, b) => b.bit - a.bit)
                    .map((d) => {
                      const key = `${byte}:${d.bit}`;
                      const on = bits.has(key);
                      return (
                        <button
                          key={key}
                          onClick={() => toggleBit(key)}
                          className={cn(
                            'flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-slate-50',
                            on ? 'text-slate-800' : 'text-slate-400',
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-3.5 items-center justify-center rounded-sm border',
                              on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white',
                            )}
                          >
                            {on ? '✓' : ''}
                          </span>
                          <span className="w-5 font-mono text-[10px] text-slate-400">b{d.bit}</span>
                          <span className="flex-1 truncate">{d.label}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">
            高字节在前：Byte0 为高字节、Byte1 为低字节；勾选即置 1，未勾选的位为 0。
            {type === 0x00 ? ' 数据区全 0 即「电池活化关闭」（现场帧 5A47050001000000F3E5）。' : ''}
          </p>
        </div>
      ) : null}

      {!rawMode && type === 0x20 ? (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="电量 %">
            <Input value={power.percent} onChange={(e) => setPower({ ...power, percent: Number(e.target.value) })} />
          </Field>
          <Field label="电池电压 V">
            <Input value={power.voltage} onChange={(e) => setPower({ ...power, voltage: Number(e.target.value) })} />
          </Field>
          <Field label="负载电压 V">
            <Input value={power.load} onChange={(e) => setPower({ ...power, load: Number(e.target.value) })} />
          </Field>
          <Field label="负载电流 A">
            <Input value={power.loadA} onChange={(e) => setPower({ ...power, loadA: Number(e.target.value) })} />
          </Field>
          <Field label="光伏电压 V">
            <Input value={power.pv} onChange={(e) => setPower({ ...power, pv: Number(e.target.value) })} />
          </Field>
          <Field label="光伏电流 A">
            <Input value={power.pvA} onChange={(e) => setPower({ ...power, pvA: Number(e.target.value) })} />
          </Field>
        </div>
      ) : null}

      {!rawMode && type === -1 ? (
        <div className="mt-3">
          <Field label="数据区 hex">
            <Input value={dataHex} onChange={(e) => setDataHex(e.target.value)} placeholder="AABB" />
          </Field>
        </div>
      ) : null}

      {!rawMode && type === 0x30 ? (
        <p className="mt-2 text-[10px] text-slate-400">
          本期终端不上报环境帧，这里仅用于构造测试帧（全 0 数据区，可在「整帧 hex」模式微调）。
        </p>
      ) : null}

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-medium text-slate-500">最终帧</span>
          <Badge tone="blue">{Math.floor(preview.replace(/[^0-9A-Fa-f]/g, '').length / 2)} 字节</Badge>
          {previewSummary ? <span className="truncate text-[10px] text-slate-400">{previewSummary}</span> : null}
        </div>
        <div className="break-all font-mono text-[11px] leading-relaxed text-slate-700">{preview}</div>
      </div>
    </Dialog>
  );
}
