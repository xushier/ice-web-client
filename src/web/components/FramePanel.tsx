import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Info, Search, X } from 'lucide-react';
import type { FrameEntry } from '@/core/types';
import { useStore } from '@/web/lib/store';
import { Badge, Button, Input, cn } from './ui';

export default function FramePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const frames = useStore((s) => s.frames);
  const modules = useStore((s) => s.state?.modules) ?? [];
  const clearFrames = useStore((s) => s.clearFrames);
  const toast = useStore((s) => s.toast);
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [moduleFilter, setModuleFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return frames
      .filter((f) => (moduleFilter ? f.moduleId === moduleFilter : true))
      .filter((f) => (onlyAbnormal ? !f.parsed.known || !f.parsed.crcOk : true))
      .filter((f) =>
        kw
          ? f.parsed.rawHex.toLowerCase().includes(kw) ||
            f.parsed.typeName.toLowerCase().includes(kw) ||
            f.moduleLabel.toLowerCase().includes(kw)
          : true,
      )
      .slice(0, 300);
  }, [frames, moduleFilter, onlyAbnormal, keyword]);

  if (!open) return null;

  return (
    <aside className="flex w-[460px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
            帧监视
            <button
              className={cn(
                'rounded p-0.5 transition-colors hover:bg-slate-100 active:bg-slate-200',
                showHelp ? 'text-slate-700' : 'text-slate-400',
              )}
              title="帧结构速查"
              onClick={() => setShowHelp(!showHelp)}
            >
              <Info className="size-3.5" />
            </button>
          </h2>
          <p className="text-[10px] text-slate-400">
            实时收发 · 缓存 {frames.length} 条 · 显示 {list.length} 条
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              clearFrames();
              toast('已清空本地显示');
            }}
          >
            清空
          </Button>
          <button
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200"
            onClick={onClose}
            title="收起"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {showHelp ? (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[10px] leading-relaxed text-slate-500">
          <div className="font-mono text-[10px] text-slate-600">
            5A 47 | 长度 | ID(2B) | 类型 | 数据(nB) | CRC(2B, 低字节在前)
          </div>
          长度 = 3 + 数据区长度（0x00 / 0x10 为 5，0x20 为 21）。ID 为 12bit，bit0 表示大小号侧。
          <br />
          0x00 是平台下发的唯一动作命令帧，数据区 16 位：接地合 b7 / 接地分 b6 / 选相1 合 b5 分 b4 / 选相2 合 b3 分 b2（低字节），
          融冰合 b3 / 融冰分 b2 / 闭锁 b1 / 开锁 b0（高字节），低字节 b1 = 电池活化开，数据区全 0 = 活化关。
          <br />
          0x10 是终端上报的 DI 状态，位定义与 0x00 不同，展开任意一帧即可逐位对照。
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-7 pl-6"
            placeholder="搜索 hex / 帧类型 / 模块"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <select
          className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] text-slate-600"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
        >
          <option value="">全部模块</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.towerName} #{m.moduleId}
            </option>
          ))}
        </select>
        <Button
          size="xs"
          variant={onlyAbnormal ? 'primary' : 'outline'}
          onClick={() => setOnlyAbnormal(!onlyAbnormal)}
          title="只显示未定义帧类型或 CRC 不一致的帧"
        >
          仅异常
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11px] text-slate-400">暂无帧记录</div>
        ) : (
          list.map((f) => (
            <FrameRow
              key={f.seq}
              frame={f}
              expanded={expanded === f.seq}
              onToggle={() => setExpanded(expanded === f.seq ? null : f.seq)}
              onCopy={() => {
                void navigator.clipboard.writeText(f.parsed.rawHex).then(() => toast('已复制帧 hex'));
              }}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function FrameRow({
  frame,
  expanded,
  onToggle,
  onCopy,
}: {
  frame: FrameEntry;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const p = frame.parsed;
  const abnormal = !p.known || !p.crcOk;
  return (
    <div className={cn('border-b border-slate-100', abnormal && 'bg-amber-50/40')}>
      <button
        className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
        onClick={onToggle}
      >
        <span className="w-14 shrink-0 pt-0.5 font-mono text-[10px] text-slate-400">
          {new Date(frame.ts).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
        <span
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded',
            frame.dir === 'tx' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600',
          )}
        >
          {frame.dir === 'tx' ? <ArrowRight className="size-3" /> : <ArrowLeft className="size-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-slate-500">0x{p.type.toString(16).padStart(2, '0')}</span>
            <span className={cn('text-[11px]', p.known ? 'text-slate-700' : 'font-medium text-amber-700')}>{p.typeName}</span>
            {!p.crcOk ? <Badge tone="rose">CRC 不符</Badge> : null}
            {!p.known ? <Badge tone="amber">未知</Badge> : null}
            <span className="ml-auto text-[10px] text-slate-300">{frame.moduleLabel}</span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500">{p.rawHex}</span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-600">{p.summary}</span>
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-dashed border-slate-200 bg-white px-3 py-2 text-[11px]">
          <div className="mb-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-500">
            <span>模块 ID：{p.idLabel}</span>
            <span>数据长度：{p.dataLen} 字节</span>
            <span>
              CRC：计算 {p.crcCalc} / 实际 {p.crcRecv}
            </span>
            <span className={p.crcOk ? 'text-emerald-600' : 'text-rose-600'}>{p.crcOk ? '校验一致' : '校验不一致'}</span>
          </div>
          <div className="mb-1.5 rounded bg-slate-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-slate-600">
            {p.rawHex}
          </div>
          {p.fields.length ? (
            <table className="w-full">
              <tbody>
                {p.fields.map((row, i) => (
                  <tr key={`${row.label}-${i}`} className="align-top">
                    <td className="w-32 py-0.5 pr-2 text-slate-500">{row.label}</td>
                    <td className="py-0.5 text-slate-700">
                      {row.value}
                      {row.note ? <span className="ml-1 text-[10px] text-slate-400">（{row.note}）</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {p.bits.length ? (
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
              {p.bits.map((b) => (
                <div key={b.bit} className={cn('flex items-center gap-1', b.on ? 'text-slate-800' : 'text-slate-300')}>
                  <span className="w-6 text-slate-400">b{b.bit}</span>
                  <span className={cn('inline-block size-1.5 rounded-full', b.on ? 'bg-emerald-500' : 'bg-slate-200')} />
                  <span className="truncate">{b.label}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex justify-end">
            <Button size="xs" variant="ghost" onClick={onCopy}>
              <Copy className="size-3" />
              复制 hex
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
