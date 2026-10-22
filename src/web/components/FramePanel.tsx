import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Search, X } from 'lucide-react';
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
    <aside className="fixed right-0 top-0 z-40 flex h-full w-[560px] flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-slate-800">帧监视</h2>
          <p className="text-[10px] text-slate-400">实时收发帧 · 共缓存 {frames.length} 条 · 显示 {list.length} 条</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={clearFrames}>
            清空
          </Button>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
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
          variant={onlyAbnormal ? 'primary' : 'ghost'}
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
      <button className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-slate-50" onClick={onToggle}>
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
