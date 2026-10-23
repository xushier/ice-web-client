import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { ModuleConfig, ServerConfig } from '@/core/types';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import { Button, Dialog, Field, Input, Select, Switch } from './ui';

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const server = useStore((s) => s.state?.server);
  const run = useStore((s) => s.run);
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<ServerConfig | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && server) setDraft({ ...server });
  }, [open, server]);

  if (!server || !draft) {
    return <Dialog open={open} onClose={onClose} title="服务器与上报参数">{null}</Dialog>;
  }

  const set = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]) =>
    setDraft({ ...draft, [key]: value });

  const exportConfig = async () => {
    const data = await api.exportConfig();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ice-web-client-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text) as { server?: ServerConfig; modules?: ModuleConfig[] };
    if (!confirm(`导入将清空当前 ${useStore.getState().state?.modules.length ?? 0} 个模块并重建，继续？`)) return;
    await api.importConfig(data);
    toast('配置已导入');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="服务器与上报参数"
      description="修改后对「新连接」及下一次重连生效；上报周期立即生效。"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              void run(async () => {
                await api.updateServer(draft);
                onClose();
              })
            }
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section>
          <h3 className="mb-2 text-[11px] font-medium text-slate-500">服务端</h3>
          <p className="mb-2 text-[10px] leading-relaxed text-slate-400">
            平台按帧里的模块 ID（12bit，bit0 为大小号侧）判定该塔是否在线，所以这里的端口与各模块的 ID 必须和平台配置一致。
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="IP 或域名">
                <Input
                  value={draft.host}
                  placeholder="10.10.10.143"
                  onChange={(e) => set('host', e.target.value.trim())}
                />
              </Field>
            </div>
            <Field label="端口">
              <Input
                value={draft.port}
                inputMode="numeric"
                onChange={(e) => set('port', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="连接超时 (ms)">
              <Input
                value={draft.connectTimeoutMs}
                inputMode="numeric"
                onChange={(e) => set('connectTimeoutMs', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="CRC 策略" hint="auto = 按 CRC-16/MODBUS 计算；zero = 尾部填 00 00（调试用）。">
              <Select value={draft.crcMode} onChange={(e) => set('crcMode', e.target.value as 'auto' | 'zero')}>
                <option value="auto">正确计算</option>
                <option value="zero">填 00 00</option>
              </Select>
            </Field>
            <div className="flex flex-col justify-end gap-1.5 pb-1">
              <Switch checked={draft.autoReconnect} onChange={(v) => set('autoReconnect', v)} label="断线自动重连" />
              <Switch
                checked={draft.registerOnConnect}
                onChange={(v) => set('registerOnConnect', v)}
                label="连接后发 0x05 上线帧"
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-medium text-slate-500">上报节奏</h3>
          <div className="grid grid-cols-3 gap-3">
            <Field label="0x10 周期 (秒)">
              <Input
                value={draft.statusIntervalSec}
                inputMode="numeric"
                onChange={(e) => set('statusIntervalSec', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="0x20 周期 (秒)" hint="默认 3600（60 分钟）">
              <Input
                value={draft.powerIntervalSec}
                inputMode="numeric"
                onChange={(e) => set('powerIntervalSec', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="0x30 周期 (秒)" hint="协议范围 120~3600">
              <Input
                value={draft.envIntervalSec}
                inputMode="numeric"
                onChange={(e) => set('envIntervalSec', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="命令 ACK (0x01)">
              <div className="pt-2">
                <Switch checked={draft.ackCommand} onChange={(v) => set('ackCommand', v)} label="收到 0x00 立即应答" />
              </div>
            </Field>
            <div className="col-span-2 flex flex-col justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
              <Switch
                checked={draft.hourlyBundle}
                onChange={(v) => set('hourlyBundle', v)}
                label="每小时整包上报（0x10 + 0x20）"
              />
              <Switch
                checked={draft.alignHourly}
                onChange={(v) => set('alignHourly', v)}
                label="整点对齐（每小时 :00:05）"
                disabled={!draft.hourlyBundle}
              />
              <Switch
                checked={draft.envReport}
                onChange={(v) => set('envReport', v)}
                label="同时上报 0x30 环境帧（实测本平台会断开，默认关闭）"
              />
              <span className="text-[10px] leading-relaxed text-slate-400">
                平台历史数据页需要的是一整组同时刻数据：刀闸状态 + 电池/太阳能。开启整包后按 0x20 周期连发两帧；
                关闭则各自按自己的周期单独发。整点对齐可避免「连接时刻是 14:37，就永远在 :37 上报」。
              </span>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-medium text-slate-500">自动模式</h3>
          <div className="grid grid-cols-4 items-end gap-3">
            <Field label="延时 (秒)">
              <Input
                value={draft.autoDelaySec}
                inputMode="numeric"
                onChange={(e) => set('autoDelaySec', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="随机抖动 (ms)">
              <Input
                value={draft.autoJitterMs}
                inputMode="numeric"
                onChange={(e) => set('autoJitterMs', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <div className="pb-1">
              <Switch
                checked={draft.autoModeDefault}
                onChange={(v) => set('autoModeDefault', v)}
                label="默认开启自动模式"
              />
            </div>
            <div className="pb-1">
              <Switch
                checked={draft.autoParallel}
                onChange={(v) => set('autoParallel', v)}
                label="多动作并行执行"
              />
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
            自动模式按 1:1 映射：合闸 → 合闸到位，分闸 → 分闸到位，闭锁 → 闭锁到位，开锁 → 开锁到位。
            串行模式下多个动作按卡片中的设备顺序依次延时执行。
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-medium text-slate-500">塔视图动画时长</h3>
          <div className="grid grid-cols-3 gap-3">
            <Field label="接地 / 选相刀闸 (秒)" hint="默认 5 秒">
              <Input
                value={draft.animSwitchSec}
                inputMode="numeric"
                onChange={(e) => set('animSwitchSec', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="融冰锁 (秒)" hint="默认 10 秒">
              <Input
                value={draft.animLockSec}
                inputMode="numeric"
                onChange={(e) => set('animLockSec', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
            <Field label="融冰刀闸 (秒)" hint="默认 15 秒">
              <Input
                value={draft.animIceSec}
                inputMode="numeric"
                onChange={(e) => set('animIceSec', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
              />
            </Field>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
            只影响塔视图里的动作时长；设备状态仍然在点击时立即上报。范围 1~120 秒。
          </p>
        </section>

        <section className="border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-[11px] font-medium text-slate-500">配置迁移</h3>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void run(exportConfig)}>
              <Download className="size-3.5" />
              导出配置
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" />
              导入配置
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void run(() => importConfig(file));
                e.target.value = '';
              }}
            />
          </div>
        </section>
      </div>
    </Dialog>
  );
}
