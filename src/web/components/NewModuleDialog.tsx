import { useState } from 'react';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import { Button, Dialog, Field, Input, Select, Switch } from './ui';

export default function NewModuleDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const run = useStore((s) => s.run);
  const modules = useStore((s) => s.state?.modules) ?? [];
  const [towerName, setTowerName] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [phaseCount, setPhaseCount] = useState(2);
  const [connectNow, setConnectNow] = useState(true);

  const reset = () => {
    setTowerName('');
    setModuleId('');
    setPhaseCount(2);
    setConnectNow(true);
  };

  const submit = async (connect: boolean) => {
    const id = Number(moduleId);
    if (!moduleId.trim() || Number.isNaN(id) || id < 0 || id > 4095) {
      throw new Error('模块 ID 必须是 0~4095 的整数');
    }
    if (modules.some((m) => m.moduleId === id)) {
      throw new Error(`模块 ID ${id} 已存在，请先删除或改用其他 ID`);
    }
    await api.createModule({
      towerName: towerName.trim() || `铁塔 ${id}`,
      moduleId: id,
      phaseCount,
      autoConnect: connect,
    });
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="新建主控模块"
      description="一个模块对应一条独立 TCP 连接；ID 与平台配置一致后，平台会判定该模块在线。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void run(() => submit(false))}>仅创建</Button>
          <Button variant="primary" onClick={() => void run(() => submit(connectNow))}>
            创建并连接
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="铁塔号（仅用于界面区分）">
            <Input
              value={towerName}
              placeholder="例如 220kV 桂山线 #12 塔"
              onChange={(e) => setTowerName(e.target.value)}
            />
          </Field>
          <Field
            label="主控模块 ID"
            hint="写入帧 ID 字段（12bit）。bit0 即大小号侧：偶数=小号侧，奇数=大号侧。"
          >
            <Input
              value={moduleId}
              inputMode="numeric"
              placeholder="例如 12"
              onChange={(e) => setModuleId(e.target.value.replace(/[^\d]/g, ''))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="选相刀闸数量" hint="协议仅定义 1、2 两组的合/分位，第 3 个起不上报。">
            <Select value={phaseCount} onChange={(e) => setPhaseCount(Number(e.target.value))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 个
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end pb-1">
            <Switch checked={connectNow} onChange={setConnectNow} label="创建后立即连接" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          <div className="mb-1 font-medium text-slate-600">默认初始状态</div>
          接地刀闸：合闸到位 · 融冰刀闸：分闸到位 · 融冰锁：闭锁到位 · 选相刀闸：合闸到位 · 电池活化：关
          <br />
          电池电压 46.0~56.0V 随机 · 电量 50~100% 随机 · 光伏电压 ≤80V 随机 · 控制模式：远程
          <br />
          <span className="text-slate-400">创建后可在卡片上逐项调整，再点「连接」。</span>
        </div>
      </div>
    </Dialog>
  );
}
