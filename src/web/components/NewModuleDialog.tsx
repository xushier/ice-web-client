import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { getProfile, type ProtocolId } from '@/protocol/bits';
import { deviceMeta, orderDevices, type ModuleSnapshot } from '@/core/types';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import { Button, Dialog, Field, Input, Select, Switch, cn } from './ui';

const ALL_KEYS = ['ground', 'ground2', 'phase1', 'phase2', 'phase3', 'lock', 'ice', 'activation'];

const PROTOCOLS: Array<{ id: ProtocolId; label: string; hint: string }> = [
  { id: 'mg400', label: 'MG400', hint: '1 个接地刀闸、最多 2 个选相、电量档、电池活化' },
  { id: 'mg500', label: 'MG500', hint: '2 个接地刀闸、最多 3 个选相、通信链路上报、无电量档/活化' },
];

const DEFAULT_ENABLED: Record<string, boolean> = {
  ground: true,
  ground2: false,
  ice: true,
  lock: true,
  activation: false,
};

export default function NewModuleDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: ModuleSnapshot | null;
}) {
  const run = useStore((s) => s.run);
  const toast = useStore((s) => s.toast);
  const modules = useStore((s) => s.state?.modules) ?? [];

  const [protocol, setProtocol] = useState<ProtocolId>('mg400');
  const [towerName, setTowerName] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ ...DEFAULT_ENABLED });
  const [phaseCount, setPhaseCount] = useState(2);
  const [order, setOrder] = useState<string[]>(() => orderDevices(ALL_KEYS));
  const [connectNow, setConnectNow] = useState(true);

  const reset = () => {
    setTowerName('');
    setModuleId('');
    setProtocol('mg400');
    setEnabled({ ...DEFAULT_ENABLED });
    setPhaseCount(2);
    setOrder(orderDevices(ALL_KEYS));
    setConnectNow(true);
  };

  // 打开时按「新建 / 编辑」灌入初值；关掉再开也能恢复正确内容
  useEffect(() => {
    if (!open) return;
    if (!editing) {
      reset();
      return;
    }
    const phases = editing.devices.filter((k) => k.startsWith('phase')).length;
    setProtocol(editing.protocol);
    setTowerName(editing.towerName);
    setModuleId(String(editing.moduleId));
    setEnabled({
      ground: editing.devices.includes('ground'),
      ground2: editing.devices.includes('ground2'),
      ice: editing.devices.includes('ice'),
      lock: editing.devices.includes('lock'),
      activation: editing.devices.includes('activation'),
    });
    setPhaseCount(phases);
    setOrder([...editing.devices, ...orderDevices(ALL_KEYS).filter((k) => !editing.devices.includes(k))]);
    setConnectNow(editing.autoConnect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const profile = getProfile(protocol);
  const deviceToggles = useMemo(() => {
    const fixed = profile.devices.filter((k) => !k.startsWith('phase') && k !== 'activation');
    const items = fixed.map((key) => ({ key, label: deviceMeta(key).name }));
    if (profile.hasActivation) items.push({ key: 'activation', label: '电池活化' });
    return items;
  }, [profile]);

  const selected = useMemo(() => {
    const keys = new Set<string>();
    for (const key of profile.devices) {
      if (key.startsWith('phase')) continue;
      if (key === 'activation' ? enabled.activation : enabled[key]) keys.add(key);
    }
    for (let i = 1; i <= Math.min(phaseCount, profile.maxPhases); i++) keys.add(`phase${i}`);
    return order.filter((k) => keys.has(k));
  }, [enabled, phaseCount, profile, order]);

  const pickProtocol = (id: ProtocolId) => {
    if (editing && id !== editing.protocol && selected.length > 0) {
      const next = getProfile(id);
      const kept = selected.filter((k) => next.devices.includes(k));
      if (kept.length !== selected.length) {
        toast(`已切换协议：${selected.length - kept.length} 个该协议不支持的设备已取消勾选`);
      }
    }
    setProtocol(id);
    const next = getProfile(id);
    setEnabled({
      ground: true,
      ground2: next.devices.includes('ground2'),
      ice: true,
      lock: true,
      activation: false,
    });
    setPhaseCount((n) => Math.min(n, next.maxPhases));
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
    if (modules.some((m) => m.moduleId === id && m.id !== editing?.id)) {
      throw new Error(`模块 ID ${id} 已存在，请先删除或改用其他 ID`);
    }
    if (selected.length === 0) throw new Error('至少要选择一个设备');

    if (editing) {
      await api.updateModule(editing.id, {
        protocol,
        towerName: towerName.trim() || `铁塔 ${id}`,
        moduleId: id,
        devices: selected,
      });
      toast(`模块 #${id} 信息已更新${id !== editing.moduleId ? '，建议重连一次' : ''}`);
      onClose();
      return;
    }

    await api.createModule({
      protocol,
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
      title={editing ? '修改模块信息' : '新建主控模块'}
      description={
        editing
          ? '协议、ID、铁塔号、设备勾选与展示顺序都可以改；修改 ID 后建议重连一次，让平台重新绑定。'
          : '一个模块对应一条独立 TCP 连接。协议不同，0x10 状态位定义不同，不能混用。'
      }
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          {editing ? (
            <Button variant="primary" onClick={() => void run(() => submit(false))}>
              保存修改
            </Button>
          ) : (
            <>
              <Button onClick={() => void run(() => submit(false))}>仅创建</Button>
              <Button variant="primary" onClick={() => void run(() => submit(connectNow))}>
                {connectNow ? '创建并连接' : '创建'}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[11px] font-medium text-slate-600">协议</div>
          <div className="grid grid-cols-2 gap-2">
            {PROTOCOLS.map((p) => (
              <button
                key={p.id}
                onClick={() => pickProtocol(p.id)}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-left transition-colors active:scale-[0.99]',
                  protocol === p.id
                    ? 'border-slate-800 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="text-[12px] font-medium">{p.label}</div>
                <div className={cn('mt-0.5 text-[10px]', protocol === p.id ? 'text-slate-300' : 'text-slate-400')}>
                  {p.hint}
                </div>
              </button>
            ))}
          </div>
        </div>

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
            {deviceToggles.map((d) => (
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
              {Array.from({ length: profile.maxPhases + 1 }, (_, i) => i).map((n) => (
                <option key={n} value={n}>
                  {n} 个
                </option>
              ))}
            </Select>
            <span className="whitespace-nowrap text-[10px] text-slate-400">
              {profile.label} 最多 {profile.maxPhases} 个
            </span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600">展示顺序（从上到下）</span>
            <span className="text-[10px] text-slate-400">默认：接地 → 选相 → 融冰锁 → 融冰 → 活化</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-1">
            {selected.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-slate-400">还没有选择设备</div>
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
          {editing ? (
            <span className="text-[10px] text-slate-400">
              当前设备状态会保留；新增设备按初始态（接地合 · 选相分 · 锁闭锁 · 融冰分）补齐
            </span>
          ) : (
            <>
              <Switch checked={connectNow} onChange={setConnectNow} label="创建后立即连接" />
              <span className="text-[10px] text-slate-400">初始态：接地合 · 选相分 · 锁闭锁 · 融冰分</span>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
