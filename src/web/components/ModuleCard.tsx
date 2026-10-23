import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  GripVertical,
  Pencil,
  Power,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ModuleSnapshot, Telemetry } from '@/core/types';
import { deviceButtons, deviceMeta, hasStatusBit } from '@/core/types';
import { getProfile, KIND_LABEL, type DeviceState } from '@/protocol/bits';
import { encodeFrame, toHexUpper } from '@/protocol/frame';
import { api } from '@/web/lib/api';
import { copyText } from '@/web/lib/clipboard';
import { useStore } from '@/web/lib/store';
import { Badge, Button, CounterChip, Input, Select, Stat, StatusPill, Switch, cn, type Tone } from './ui';

const LINK_STYLE: Record<ModuleSnapshot['link'], { dot: string; tone: Tone; label: string }> = {
  online: { dot: 'bg-emerald-500', tone: 'emerald', label: '在线' },
  connecting: { dot: 'bg-amber-500', tone: 'amber', label: '连接中' },
  offline: { dot: 'bg-rose-500', tone: 'rose', label: '离线' },
  idle: { dot: 'bg-slate-300', tone: 'slate', label: '未连接' },
};

function relTime(ts: number | null): string {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s 前`;
  if (s < 3600) return `${Math.floor(s / 60)}m 前`;
  return `${Math.floor(s / 3600)}h 前`;
}

const TONE_ACTIVE: Record<string, string> = {
  initial: 'border-emerald-500 bg-emerald-500 text-white shadow-sm',
  moving: 'border-amber-500 bg-amber-500 text-white shadow-sm',
  melt: 'border-rose-500 bg-rose-500 text-white shadow-sm',
};

const TONE_IDLE: Record<string, string> = {
  initial: 'border-slate-200 bg-white text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50',
  moving: 'border-slate-200 bg-white text-amber-700 hover:border-amber-300 hover:bg-amber-50',
  melt: 'border-slate-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50',
};

export default function ModuleCard({ m, onEdit }: { m: ModuleSnapshot; onEdit: () => void }) {
  const server = useStore((s) => s.state?.server);
  const run = useStore((s) => s.run);
  const toast = useStore((s) => s.toast);
  const [editTel, setEditTel] = useState(false);
  const [draft, setDraft] = useState<Telemetry>(m.telemetry);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackHex, setFallbackHex] = useState('');

  const autoOn = m.autoMode === 'on' || (m.autoMode === 'inherit' && !!server?.autoModeDefault);
  const link = LINK_STYLE[m.link];

  const buildStatusHex = (): string => {
    const st = m.states;
    const profile = getProfile(m.protocol);
    const data = profile.encodeStatus({
      ground: (st.ground as DeviceState) ?? 'closed',
      ground2: st.ground2 as DeviceState | undefined,
      ice: (st.ice as DeviceState) ?? 'open',
      lock: (st.lock as DeviceState) ?? 'locked',
      phases: [
        (st.phase1 as DeviceState) ?? 'open',
        (st.phase2 as DeviceState) ?? 'open',
        (st.phase3 as DeviceState) ?? 'open',
      ],
      controlMode: m.telemetry.controlMode,
      networkError: m.telemetry.networkError,
      batteryPercent: m.telemetry.batteryPercent,
      linkType: m.telemetry.linkType,
    });
    return toHexUpper(encodeFrame({ id: m.moduleId, type: 0x10, data }));
  };

  const copyStatusFrame = () => {
    const hex = buildStatusHex();
    void copyText(hex).then(
      () => {
        setCopied(true);
        setFallbackHex('');
        setTimeout(() => setCopied(false), 1600);
        toast(`已复制当前 0x10 帧：${hex}`);
      },
      () => {
        // 兜底：自动复制被浏览器拒绝时，把十六进制摊出来让用户手动选中复制
        setFallbackHex(hex);
        toast('浏览器拒绝自动复制，已展开帧内容，请手动选中复制', 'error');
      },
    );
  };

  const toggleTel = () => {
    if (editTel) {
      setEditTel(false);
      return;
    }
    setDraft(m.telemetry);
    setEditTel(true);
  };

  const doReport = async (opts: { includePower?: boolean; includeEnv?: boolean; history?: boolean }, label: string) => {
    setBusy(true);
    try {
      await api.report(m.id, opts);
      toast(label);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-slate-800">{m.towerName}</span>
              <Badge className="font-mono">#{m.moduleId}</Badge>
              <Badge tone="blue">{m.protocol.toUpperCase()}</Badge>
              <Badge tone={m.moduleId & 1 ? 'blue' : 'slate'}>{m.moduleId & 1 ? '大号侧' : '小号侧'}</Badge>
              {autoOn ? <Badge tone="amber">自动</Badge> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <StatusPill tone={link.tone}>{link.label}</StatusPill>
              <CounterChip label="收" value={m.rxCount} icon={<ArrowDown className="size-2.5" />} tone="emerald" />
              <CounterChip label="发" value={m.txCount} icon={<ArrowUp className="size-2.5" />} tone="blue" />
              {m.telemetry.networkError ? <StatusPill tone="rose">网络错误</StatusPill> : null}
              <span className="text-[10px] text-slate-400">{m.lastRx ? relTime(m.lastRx) : '尚未收帧'}</span>
            </div>
            {m.error ? (
              <div className="mt-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-1 text-[10px] leading-tight text-rose-700">
                {m.error}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              title="修改模块信息（协议 / ID / 铁塔号 / 设备）"
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200"
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              title="重连"
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200"
              onClick={() => void run(() => api.link(m.id, 'reconnect'))}
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              title={m.link === 'online' ? '断开' : '连接'}
              className={cn(
                'rounded p-1.5 transition-colors hover:bg-slate-100 active:bg-slate-200',
                m.link === 'online' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-700',
              )}
              onClick={() => void run(() => api.link(m.id, m.link === 'online' ? 'disconnect' : 'connect'))}
            >
              <Power className="size-3.5" />
            </button>
            <button
              title="删除模块"
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 active:bg-rose-100"
              onClick={() => {
                if (confirm(`删除模块「${m.towerName} #${m.moduleId}」？`)) void run(() => api.deleteModule(m.id));
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {m.pending.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-amber-800">
            <Zap className="size-3" />
            收到平台指令
            {autoOn ? <span className="font-normal text-amber-600">· 自动模式下将自动到位</span> : null}
          </div>
          <div className="space-y-1">
            {m.pending.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <span className="flex-1 text-[11px] text-amber-900">
                  {deviceMeta(p.key).name} → {KIND_LABEL[p.kind]}
                  {p.conflict ? <span className="ml-1 text-rose-600">（冲突位，需人工判断）</span> : null}
                </span>
                <Button
                  size="xs"
                  variant="primary"
                  onClick={() =>
                    void run(async () => {
                      await api.pending(m.id, p.id, 'confirm');
                      toast(`${deviceMeta(p.key).name} 已到位`);
                    })
                  }
                >
                  已到位
                </Button>
                <Button size="xs" variant="ghost" onClick={() => void run(() => api.pending(m.id, p.id, 'dismiss'))}>
                  忽略
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-3 py-1">
        <span className="text-[10px] text-slate-400">状态：左=初始态 · 中=动作中 · 右=融冰态</span>
        <div className="flex items-center gap-1">
          <button
            className="rounded px-1.5 py-0.5 text-[10px] text-emerald-700 transition-colors hover:bg-emerald-50 active:bg-emerald-100"
            onClick={() =>
              void run(async () => {
                await api.preset(m.id, 'initial');
                toast('已切换到初始态');
              })
            }
          >
            一键初始态
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[10px] text-rose-700 transition-colors hover:bg-rose-50 active:bg-rose-100"
            onClick={() =>
              void run(async () => {
                await api.preset(m.id, 'melt');
                toast('已切换到融冰态');
              })
            }
          >
            一键融冰态
          </button>
        </div>
      </div>

      <DeviceList m={m} />

      <div className="grid grid-cols-4 gap-1.5 border-t border-slate-100 px-3 pt-2">
        <Stat
          label="电池电压"
          value={m.telemetry.batteryVoltage.toFixed(1)}
          unit="V"
          tone="emerald"
          hint={`负载 ${m.telemetry.loadVoltage.toFixed(1)}V`}
        />
        <Stat
          label="电池电量"
          value={Math.round(m.telemetry.batteryPercent)}
          unit="%"
          tone={m.telemetry.batteryPercent >= 60 ? 'emerald' : m.telemetry.batteryPercent >= 30 ? 'amber' : 'rose'}
          ratio={m.telemetry.batteryPercent}
        />
        <Stat
          label="光伏电压"
          value={m.telemetry.pvVoltage.toFixed(1)}
          unit="V"
          tone="blue"
          hint={`充电 ${m.telemetry.pvCurrent.toFixed(2)}A`}
        />
        <Stat
          label="控制模式"
          value={m.telemetry.controlMode === 'local' ? '本地' : '远程'}
          tone={m.telemetry.controlMode === 'local' ? 'amber' : 'slate'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 pb-1 text-[10px] text-slate-400">
        <span title="平台历史数据页依赖 0x10 + 0x20 + 0x30 这一整包">
          历史整包 {m.lastHistoryAt ? relTime(m.lastHistoryAt) : '未发送'}
        </span>
        <span className={m.lastPowerAck ? 'text-emerald-600' : 'text-slate-300'} title="平台收到 0x20 后回 0x21">
          0x20 {m.lastPowerAck ? '已应答' : '无应答'}
        </span>
        <span className={m.lastEnvAck ? 'text-emerald-600' : 'text-slate-300'} title="平台收到 0x30 后回 0x31">
          0x30 {m.lastEnvAck ? '已应答' : '无应答'}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] transition-colors hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200',
            editTel ? 'text-slate-700' : 'text-slate-500',
          )}
          title={editTel ? '收起遥测输入' : '展开遥测输入（电池 / 光伏 / 负载 / 环境）'}
          onClick={toggleTel}
        >
          <SlidersHorizontal className="size-3" />
          遥测
          <ChevronDown className={cn('size-3 transition-transform', editTel && 'rotate-180')} />
        </button>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="subtle" disabled={busy} title="发送 0x10 状态帧" onClick={() => void run(() => doReport({}, '已发送 0x10 状态帧'))}>
            <Send className="size-3" />
            上报
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            title="发送 0x20 供电帧"
            onClick={() => void run(() => doReport({ includePower: true }, '已发送 0x10 + 0x20'))}
          >
            供电
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            title="立即补报历史整包：0x10 + 0x20 + 0x30"
            onClick={() => void run(() => doReport({ history: true }, '已补报历史整包：0x10 + 0x20 + 0x30'))}
          >
            历史
          </Button>
          <Button
            size="xs"
            variant="ghost"
            title="复制当前 0x10 状态帧（可直接粘到帧构造器或抓包工具里比对）"
            onClick={copyStatusFrame}
          >
            {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
      </div>

      {fallbackHex ? (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
            <span>0x10 帧（点击输入框可全选）</span>
            <button className="text-slate-400 hover:text-slate-700" onClick={() => setFallbackHex('')}>
              收起
            </button>
          </div>
          <input
            readOnly
            value={fallbackHex}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-[10px] text-slate-700"
          />
        </div>
      ) : null}

      {editTel ? (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">
              电池电量 %
              <Input
                type="number"
                className="mt-0.5 h-7"
                value={draft.batteryPercent}
                onChange={(e) => setDraft({ ...draft, batteryPercent: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-500">
              电池电压 V（0.1V）
              <Input
                type="number"
                step={0.1}
                className="mt-0.5 h-7"
                value={draft.batteryVoltage}
                onChange={(e) => setDraft({ ...draft, batteryVoltage: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-500">
              光伏电压 V（≤80）
              <Input
                type="number"
                step={0.1}
                className="mt-0.5 h-7"
                value={draft.pvVoltage}
                onChange={(e) => setDraft({ ...draft, pvVoltage: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-500">
              光伏电流 A
              <Input
                type="number"
                step={0.01}
                className="mt-0.5 h-7"
                value={draft.pvCurrent}
                onChange={(e) => setDraft({ ...draft, pvCurrent: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-500">
              负载电压 V
              <Input
                type="number"
                step={0.1}
                className="mt-0.5 h-7"
                value={draft.loadVoltage}
                onChange={(e) => setDraft({ ...draft, loadVoltage: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-500">
              负载电流 A
              <Input
                type="number"
                step={0.01}
                className="mt-0.5 h-7"
                value={draft.loadCurrent}
                onChange={(e) => setDraft({ ...draft, loadCurrent: Number(e.target.value) })}
              />
            </label>
            <label className="text-[10px] text-slate-500">
              控制模式
              <Select
                className="mt-0.5 h-7"
                value={draft.controlMode}
                onChange={(e) => setDraft({ ...draft, controlMode: e.target.value as 'remote' | 'local' })}
              >
                <option value="remote">远程</option>
                <option value="local">本地</option>
              </Select>
            </label>
            {m.protocol === 'mg500' ? (
              <label className="text-[10px] text-slate-500">
                通信链路
                <Select
                  className="mt-0.5 h-7"
                  value={draft.linkType ?? '4g'}
                  onChange={(e) => setDraft({ ...draft, linkType: e.target.value as '4g' | 'fiber' })}
                >
                  <option value="4g">4G 通道</option>
                  <option value="fiber">光纤通道</option>
                </Select>
              </label>
            ) : (
              <div className="pt-4">
                <Switch
                  checked={draft.networkError}
                  onChange={(v) => setDraft({ ...draft, networkError: v })}
                  label="网络错误位"
                />
              </div>
            )}
          </div>
          <div className="mt-2 border-t border-slate-200 pt-2">
            <div className="mb-1 text-[10px] font-medium text-slate-500">环境状态（0x30）</div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[10px] text-slate-500">
                机柜温度 ℃
                <Input
                  type="number"
                  step={0.1}
                  className="mt-0.5 h-7"
                  value={draft.envTemp ?? ''}
                  onChange={(e) => setDraft({ ...draft, envTemp: Number(e.target.value) })}
                />
              </label>
              <label className="text-[10px] text-slate-500">
                机柜湿度 %RH
                <Input
                  type="number"
                  step={0.1}
                  className="mt-0.5 h-7"
                  value={draft.envHumidity ?? ''}
                  onChange={(e) => setDraft({ ...draft, envHumidity: Number(e.target.value) })}
                />
              </label>
              <label className="text-[10px] text-slate-500">
                空调状态
                <Select
                  className="mt-0.5 h-7"
                  value={draft.acState ?? 2}
                  onChange={(e) => setDraft({ ...draft, acState: Number(e.target.value) })}
                >
                  <option value={0}>0 未通电</option>
                  <option value={1}>1 待机</option>
                  <option value={2}>2 运行</option>
                  <option value={3}>3 故障</option>
                </Select>
              </label>
              <label className="text-[10px] text-slate-500">
                电池舱 1 温度 ℃
                <Input
                  type="number"
                  step={0.1}
                  className="mt-0.5 h-7"
                  value={draft.cell1Temp ?? ''}
                  onChange={(e) => setDraft({ ...draft, cell1Temp: Number(e.target.value) })}
                />
              </label>
              <label className="text-[10px] text-slate-500">
                电池舱 2 温度 ℃
                <Input
                  type="number"
                  step={0.1}
                  className="mt-0.5 h-7"
                  value={draft.cell2Temp ?? ''}
                  onChange={(e) => setDraft({ ...draft, cell2Temp: Number(e.target.value) })}
                />
              </label>
              <div className="pt-4">
                <Switch
                  checked={!!draft.fireUsed}
                  onChange={(v) => setDraft({ ...draft, fireUsed: v })}
                  label="灭火装置已用"
                />
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setEditTel(false)}>
              取消
            </Button>
            <Button
              size="xs"
              variant="primary"
              onClick={() => {
                void run(async () => {
                  await api.telemetry(m.id, draft);
                  setEditTel(false);
                  toast('遥测已保存并上报');
                });
              }}
            >
              保存并上报
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeviceList({ m }: { m: ModuleSnapshot }) {
  const run = useStore((s) => s.run);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const move = (from: string, to: string) => {
    if (from === to) return;
    const fromIdx = m.devices.indexOf(from);
    const toIdx = m.devices.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...m.devices];
    next.splice(toIdx, 0, next.splice(fromIdx, 1)[0]);
    void run(() => api.updateModule(m.id, { devices: next }));
  };

  return (
    <div className="divide-y divide-slate-100">
      {m.devices.map((key) => (
        <DeviceRow
          key={key}
          m={m}
          deviceKey={key}
          dragging={dragKey === key}
          dropTarget={!!dragKey && overKey === key && dragKey !== key}
          onDragStart={() => setDragKey(key)}
          onDragEnd={() => {
            setDragKey(null);
            setOverKey(null);
          }}
          onDragOver={() => {
            if (dragKey) setOverKey(key);
          }}
          onDrop={() => {
            if (dragKey) move(dragKey, key);
            setDragKey(null);
            setOverKey(null);
          }}
        />
      ))}
    </div>
  );
}

function DeviceRow({
  m,
  deviceKey,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  m: ModuleSnapshot;
  deviceKey: string;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const run = useStore((s) => s.run);
  const meta = deviceMeta(deviceKey);
  const current = m.states[deviceKey];
  const buttons = deviceButtons(deviceKey, current);
  const pending = m.pending.filter((p) => p.key === deviceKey);
  const showNoBitTip = !hasStatusBit(deviceKey, m.protocol) && deviceKey.startsWith('phase');

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 transition-colors',
        dragging && 'bg-slate-50 opacity-60',
        dropTarget && 'border-t-2 border-slate-500',
        pending.length > 0 && !dragging && 'bg-amber-50/60',
      )}
    >
      <span
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', deviceKey);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        title="拖动调整顺序"
        className="cursor-grab touch-none rounded p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </span>
      <span className="w-[72px] shrink-0 truncate text-[11px] text-slate-600">{meta.name}</span>
      <div className="grid flex-1 grid-cols-3 gap-1">
        {buttons.map((b) => {
          const active = current === b.value;
          const isPending = pending.some((p) => p.target === b.value);
          return (
            <button
              key={b.value}
              onClick={() => void run(() => api.setDevice(m.id, deviceKey, b.value))}
              className={cn(
                'rounded-md border px-1 py-1 text-[11px] transition-all active:scale-[0.97]',
                active ? TONE_ACTIVE[b.tone] : TONE_IDLE[b.tone],
                isPending && 'pending-ring ring-2 ring-amber-400',
              )}
            >
              {b.label}
            </button>
          );
        })}
      </div>
      {showNoBitTip ? (
        <span className="shrink-0 text-[10px] text-slate-300" title="协议只定义了选相刀闸 1、2 的 DI 位，这一个不参与 0x10 上报">
          无位
        </span>
      ) : null}
    </div>
  );
}
