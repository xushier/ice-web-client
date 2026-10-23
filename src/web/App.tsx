import { useEffect, useState } from 'react';
import {
  Box,
  ChevronLeft,
  ChevronRight,
  FolderCog,
  LayoutGrid,
  Plus,
  Radio,
  Send,
  Settings2,
  Terminal,
} from 'lucide-react';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import type { ModuleSnapshot } from '@/core/types';
import ModuleCard from '@/web/components/ModuleCard';
import TowerView from '@/web/components/TowerView';
import NewModuleDialog from '@/web/components/NewModuleDialog';
import SettingsDialog from '@/web/components/SettingsDialog';
import FramePanel from '@/web/components/FramePanel';
import FrameBuilder from '@/web/components/FrameBuilder';
import { Badge, Button, StatusPill, cn } from '@/web/components/ui';

const LINK_DOT: Record<string, string> = {
  online: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  offline: 'bg-rose-500',
  idle: 'bg-slate-300',
};

const LINK_TEXT: Record<string, string> = {
  online: '在线',
  connecting: '连接中',
  offline: '离线',
  idle: '未连接',
};

const LINK_TONE: Record<string, string> = {
  online: 'text-emerald-600',
  connecting: 'text-amber-600',
  offline: 'text-rose-600',
  idle: 'text-slate-400',
};

export default function App() {
  const init = useStore((s) => s.init);
  const state = useStore((s) => s.state);
  const ws = useStore((s) => s.ws);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const toast = useStore((s) => s.toast);
  const run = useStore((s) => s.run);

  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<ModuleSnapshot | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [framesOpen, setFramesOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1');
  const [view, setView] = useState<'cards' | 'towers'>(() =>
    localStorage.getItem('view-mode') === 'towers' ? 'towers' : 'cards',
  );

  useEffect(() => {
    init();
  }, [init]);

  const modules = useStore((s) => s.state?.modules) ?? [];
  const server = state?.server;
  const online = modules.filter((m) => m.link === 'online').length;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
  };

  const bulk = async (action: 'connect' | 'disconnect') => {
    for (const m of modules) await api.link(m.id, action);
    toast(action === 'connect' ? `已对 ${modules.length} 个模块发起连接` : `已断开 ${modules.length} 个模块`);
  };

  const pickView = (next: 'cards' | 'towers') => {
    setView(next);
    localStorage.setItem('view-mode', next);
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
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
        >
          <Settings2 className="size-3" />
          {server?.host ? `${server.host}:${server.port}` : '未配置服务器'}
        </button>

        <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-500 lg:flex">
          {ws === 'open' ? (
            <StatusPill tone="emerald">实时通道正常</StatusPill>
          ) : (
            <StatusPill tone={ws === 'connecting' ? 'amber' : 'rose'}>
              {ws === 'connecting' ? '通道连接中' : '通道断开'}
            </StatusPill>
          )}
          <StatusPill tone={online > 0 ? 'emerald' : 'slate'} dot={false}>
            在线 <b className="font-mono font-medium">{online}</b>/{modules.length}
          </StatusPill>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button
              onClick={() => pickView('cards')}
              title="卡片视图"
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[11px] transition-colors',
                view === 'cards' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <LayoutGrid className="size-3" />
              卡片
            </button>
            <button
              onClick={() => pickView('towers')}
              title="塔视图：3D 铁塔 + 设备动作动画"
              className={cn(
                'flex items-center gap-1 border-l border-slate-200 px-2 py-1 text-[11px] transition-colors',
                view === 'towers' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <Box className="size-3" />
              塔视图
            </button>
          </div>
          <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" />
            新建模块
          </Button>
          <Button size="sm" variant="outline" onClick={() => void run(() => bulk('connect'))}>
            全部连接
          </Button>
          <Button size="sm" variant="outline" onClick={() => void run(() => bulk('disconnect'))}>
            全部断开
          </Button>
          <div className="mx-1 h-4 w-px bg-slate-200" />
          <Button
            size="sm"
            variant={framesOpen ? 'primary' : 'outline'}
            onClick={() => setFramesOpen(!framesOpen)}
          >
            <Radio className="size-3.5" />
            帧监视
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBuilderOpen(true)}>
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
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200',
            collapsed ? 'w-11' : 'w-56',
          )}
        >
          <div className="flex items-center justify-between px-2 py-2 text-[11px] font-medium text-slate-500">
            {collapsed ? null : (
              <span className="inline-flex items-center gap-1">
                <FolderCog className="size-3" />
                模块
              </span>
            )}
            <div className={cn('flex items-center gap-1', collapsed && 'mx-auto flex-col')}>
              {collapsed ? null : (
                <button
                  className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:bg-slate-200"
                  onClick={() => setNewOpen(true)}
                  title="新建模块"
                >
                  <Plus className="size-3.5" />
                </button>
              )}
              <button
                className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 active:bg-slate-200"
                onClick={toggleCollapsed}
                title={collapsed ? '展开模块栏' : '折叠模块栏'}
              >
                {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
              </button>
            </div>
          </div>

          <div className={cn('min-h-0 flex-1 overflow-y-auto pb-2', collapsed ? 'px-1' : 'px-1.5')}>
            {modules.length === 0 ? (
              collapsed ? null : (
                <p className="px-2 py-4 text-[11px] leading-relaxed text-slate-400">
                  还没有模块。点上方 + 新建一个主控模块，填入平台配置的 ID。
                </p>
              )
            ) : (
              modules.map((m) => (
                <button
                  key={m.id}
                  onClick={() => document.getElementById(`mod-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  title={`${m.towerName} #${m.moduleId} · ${LINK_TEXT[m.link]}`}
                  className={cn(
                    'mb-0.5 flex w-full items-center rounded-lg text-left transition-colors hover:bg-slate-50 active:bg-slate-100',
                    collapsed ? 'justify-center py-2' : 'gap-2 px-2 py-1.5',
                  )}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', LINK_DOT[m.link])} />
                  {collapsed ? null : (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-slate-700">{m.towerName}</span>
                      <span className="mt-0.5 flex items-center gap-1">
                        <span className="font-mono text-[10px] text-slate-400">#{m.moduleId}</span>
                        <span className={cn('text-[10px]', LINK_TONE[m.link])}>{LINK_TEXT[m.link]}</span>
                      </span>
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
          {modules.length === 0 ? (
            <div className="mt-20 text-center">
              <p className="text-[13px] text-slate-500">先创建一个主控模块</p>
              <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-slate-400">
                填写平台里配置的模块 ID（例如 12），选择该塔下的设备与展示顺序，连接后终端会把各设备状态上报给平台。
              </p>
              <Button className="mt-4" variant="primary" onClick={() => setNewOpen(true)}>
                <Plus className="size-3.5" />
                新建模块
              </Button>
            </div>
          ) : view === 'towers' && server ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {modules.map((m) => (
                <div key={m.id} id={`mod-${m.id}`}>
                  <TowerView m={m} server={server} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {modules.map((m) => (
                <div key={m.id} id={`mod-${m.id}`}>
                  <ModuleCard m={m} onEdit={() => setEditing(m)} />
                </div>
              ))}
            </div>
          )}
        </main>

        <FramePanel open={framesOpen} onClose={() => setFramesOpen(false)} />
      </div>

      <NewModuleDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        editing={null}
      />
      <NewModuleDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FrameBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} />

      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-1.5">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={cn(
              'pointer-events-auto rounded-lg px-3 py-1.5 text-[11px] shadow-lg transition-transform active:scale-[0.98]',
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
