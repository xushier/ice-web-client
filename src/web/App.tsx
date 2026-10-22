import { useEffect, useState } from 'react';
import { FolderCog, Plus, Radio, Send, Settings2, Terminal, Wifi, WifiOff } from 'lucide-react';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import ModuleCard from '@/web/components/ModuleCard';
import NewModuleDialog from '@/web/components/NewModuleDialog';
import SettingsDialog from '@/web/components/SettingsDialog';
import FramePanel from '@/web/components/FramePanel';
import FrameBuilder from '@/web/components/FrameBuilder';
import { Badge, Button, cn } from '@/web/components/ui';

export default function App() {
  const init = useStore((s) => s.init);
  const state = useStore((s) => s.state);
  const ws = useStore((s) => s.ws);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const run = useStore((s) => s.run);

  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [framesOpen, setFramesOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  const modules = useStore((s) => s.state?.modules) ?? [];
  const server = state?.server;
  const online = modules.filter((m) => m.link === 'online').length;

  const bulk = async (action: 'connect' | 'disconnect') => {
    for (const m of modules) await api.link(m.id, action);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <div className="flex size-6 items-center justify-center rounded bg-slate-900 text-white">
            <Terminal className="size-3.5" />
          </div>
          <span className="text-[13px] font-medium text-slate-800">融冰终端模拟器</span>
          <Badge>MG400</Badge>
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
        >
          <Settings2 className="size-3" />
          {server?.host ? `${server.host}:${server.port}` : '未配置服务器'}
        </button>

        <div className="hidden shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-slate-500 lg:flex">
          {ws === 'open' ? (
            <>
              <Wifi className="size-3 text-emerald-500" />
              实时通道正常
            </>
          ) : (
            <>
              <WifiOff className="size-3 text-rose-500" />
              {ws === 'connecting' ? '连接中…' : '通道断开，重试中'}
            </>
          )}
          <span className="mx-1 text-slate-300">|</span>
          <span>
            在线 <b className="font-medium text-slate-700">{online}</b>/{modules.length}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" />
            新建模块
          </Button>
          <Button size="sm" variant="ghost" className="hidden xl:inline-flex" onClick={() => void run(() => bulk('connect'))}>
            全部连接
          </Button>
          <Button size="sm" variant="ghost" className="hidden xl:inline-flex" onClick={() => void run(() => bulk('disconnect'))}>
            全部断开
          </Button>
          <div className="mx-1 hidden h-4 w-px bg-slate-200 xl:block" />
          <Button size="sm" variant="ghost" onClick={() => setFramesOpen(true)}>
            <Radio className="size-3.5" />
            帧监视
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBuilderOpen(true)}>
            <Send className="size-3.5" />
            帧构造器
          </Button>
        </div>
      </header>

      {!server?.host ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800">
          还没有配置服务端地址，先点左上角「未配置服务器」填写 IP / 域名与端口。
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex items-center justify-between px-3 py-2 text-[11px] font-medium text-slate-500">
            <span className="inline-flex items-center gap-1">
              <FolderCog className="size-3" />
              模块
            </span>
            <button className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => setNewOpen(true)}>
              <Plus className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {modules.length === 0 ? (
              <p className="px-2 py-4 text-[11px] leading-relaxed text-slate-400">
                还没有模块。点上方 + 新建一个主控模块，填入平台配置的 ID。
              </p>
            ) : (
              modules.map((m) => (
                <button
                  key={m.id}
                  onClick={() => document.getElementById(`mod-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      m.link === 'online'
                        ? 'bg-emerald-500'
                        : m.link === 'connecting'
                          ? 'bg-amber-500'
                          : m.link === 'offline'
                            ? 'bg-rose-500'
                            : 'bg-slate-300',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-slate-700">{m.towerName}</span>
                    <span className="block text-[10px] text-slate-400">
                      #{m.moduleId} · {m.link === 'online' ? '在线' : m.link === 'connecting' ? '连接中' : m.link === 'offline' ? '离线' : '未连接'}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
            每个模块一条独立 TCP；平台按 ID 绑定铁塔。
          </div>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          {modules.length === 0 ? (
            <div className="mt-20 text-center">
              <p className="text-[13px] text-slate-500">先创建一个主控模块</p>
              <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-slate-400">
                填写平台里配置的模块 ID（例如 12），选择该塔下的设备与数量，连接后终端会把各设备状态上报给平台。
              </p>
              <Button className="mt-4" variant="primary" onClick={() => setNewOpen(true)}>
                <Plus className="size-3.5" />
                新建模块
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {modules.map((m) => (
                <div key={m.id} id={`mod-${m.id}`}>
                  <ModuleCard m={m} />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <FramePanel open={framesOpen} onClose={() => setFramesOpen(false)} />
      <NewModuleDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FrameBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} />

      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-1.5">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={cn(
              'pointer-events-auto rounded-lg px-3 py-1.5 text-[11px] shadow-lg',
              t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white',
            )}
          >
            {t.text}
          </button>
        ))}
      </div>
    </div>
  );
}
