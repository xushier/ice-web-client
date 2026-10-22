import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { deviceMeta, orderDevices } from '@/core/types';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import { Badge, Button, Dialog, Field, Input, Select, Switch, cn } from './ui';

const ALL_KEYS = ['ground', 'phase1', 'phase2', 'phase3', 'phase4', 'lock', 'ice', 'activation'];
const DEFAULTS = orderDevices(ALL_KEYS);

export default function NewModuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useStore((s) => s.run);
  const toast = useStore((s) => s.toast);
  const modules = useStore((s) => s.state?.modules) ?? [];

  const [towerName, setTowerName] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    ground: true,
    ice: true,
    lock: true,
    activation: true,
  });
  const [phaseCount, setPhaseCount] = useState(2);
  const [order, setOrder] = useState<string[]>(DEFAULTS);
  const [connectNow, setConnectNow] = useState(true);

  const selected = useMemo(() => {
    const keys = new Set<string>();
    for (const key of ['ground', 'ice', 'lock', 'activation']) if (enabled[key]) keys.add(key);
    for (let i = 1; i <= phaseCount; i++) keys.add(`phase${i}`);
    return order.filter((k) => keys.has(k));
  }, [enabled, phaseCount, order]);

  const reset = () => {
    setTowerName('');
    setModuleId('');
    setEnabled({ ground: true, ice: true, lock: true, activation: true });
    setPhaseCount(2);
    setOrder(DEFAULTS);
    setConnectNow(true);
  };

  const move = (key: string, dir: -1 | 1) => {
    const index = selected.indexOf(key);
    const targetKey = selected[index + dir];
    if (!targetKey) return;
    const next = [...order];
    const a = next.indexOf(key);
    const b = next.indexOf(targetKey);
    next[a] = targetKey;
    next[b] = key;
    setOrder(next);
  };

  const submit = async (connect: boolean) => {
    const id = Number(moduleId);
    if (!moduleId.trim() || Number.isNaN(id) || id < 0 || id > 4095) {
      throw new Error('模块 ID 必须是 0~4095 的整数');
    }
    if (modules.some((m) => m.moduleId === id)) {
      throw new Error(`模块 ID ${id} 已存在，请先删除或改用其他 ID`);
    }
    if (selected.length === 0) throw new Error('至少要选择一个设备');
    await api.createModule({
      towerName: towerName.trim() || `铁塔 ${id}`,
      moduleId: id,
      devices: selected,
      autoConnect: connect,
    });
    toast(`模块 #${id} 已创建${connect ? '并连接' : ''}`);
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="新建主控模块"
      description="一个模块对应一条独立 TCP 连接。设备按下方顺序展示，可上下调整。"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void run(() => submit(false))}>仅创建</Button>
          <Button variant="primary" onClick={() => void run(() => submit(connectNow))}>
            {connectNow ? '创建并连接' : '创建'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="铁塔号（仅用于界面区分）">
            <Input value={towerName} placeholder="例如 220kV 桂山线 #12 塔" onChange={(e) => setTowerName(e.target.value)} />
          </Field>
          <Field label="主控模块 ID" hint="写入帧 ID 字段（12bit）。bit0 即大小号侧：偶数=小号侧，奇数=大号侧。">
            <Input
              value={moduleId}
              inputMode="numeric"
              placeholder="例如 12"
              onChange={(e) => setModuleId(e.target.value.replace(/[^\d]/g, ''))}
            />
          </Field>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-slate-600">选择设备</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { key: 'ground', label: '接地刀闸' },
              { key: 'ice', label: '融冰刀闸' },
              { key: 'lock', label: '融冰锁' },
              { key: 'activation', label: '电池活化' },
            ].map((d) => (
              <button
                key={d.key}
                onClick={() => setEnabled({ ...enabled, [d.key]: !enabled[d.key] })}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors active:scale-[0.98]',
                  enabled[d.key]
                    ? 'border-slate-800 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <span
                  className={cn(
                    'flex size-3.5 items-center justify-center rounded-sm border',
                    enabled[d.key] ? 'border-white bg-white text-slate-900' : 'border-slate-300',
                  )}
                >
                  {enabled[d.key] ? <Check className="size-2.5" /> : null}
                </span>
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-500">选相刀闸数量</span>
            <Select className="h-7 w-20" value={phaseCount} onChange={(e) => setPhaseCount(Number(e.target.value))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 个
                </option>
              ))}
            </Select>
            {phaseCount > 2 ? (
              <Badge tone="amber">第 3 个起无状态位</Badge>
            ) : (
              <span className="whitespace-nowrap text-[10px] text-slate-400">协议只定义了 1、2 两组合/分位</span>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600">展示顺序（从上到下）</span>
            <span className="text-[10px] text-slate-400">默认：接地 → 选相 → 融冰锁 → 融冰 → 活化</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-1">
            {selected.length === 0 ? (
              <div className="px-2 py-4 text-center text-[11px] text-slate-400">还没有选择设备</div>
            ) : (
              selected.map((key, index) => (
                <div key={key} className="flex items-center gap-2 rounded-md bg-white px-2 py-1">
                  <span className="w-4 text-[10px] text-slate-400">{index + 1}</span>
                  <span className="flex-1 text-[11px] text-slate-700">{deviceMeta(key).name}</span>
                  <button
                    disabled={index === 0}
                    onClick={() => move(key, -1)}
                    className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    disabled={index === selected.length - 1}
                    onClick={() => move(key, 1)}
                    className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ArrowDown className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Switch checked={connectNow} onChange={setConnectNow} label="创建后立即连接" />
          <span className="text-[10px] text-slate-400">初始态：接地合 · 选相分 · 锁闭锁 · 融冰分 · 活化关</span>
        </div>
      </div>
    </Dialog>
  );
}
