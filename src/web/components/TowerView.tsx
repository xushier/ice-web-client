import { useEffect, useState } from 'react';
import type { ModuleSnapshot, ServerConfig } from '@/core/types';
import { deviceMeta } from '@/core/types';
import { api } from '@/web/lib/api';
import { useStore } from '@/web/lib/store';
import { cn } from './ui';

/**
 * 塔视图：用 2.5D SVG 还原一套「铁塔 + 地线 + 横担 + 导线跳线 + 融冰刀闸 + 融冰锁 + 接地/选相刀闸」，
 * 设备状态变化时按设置的时长播放动画。
 *
 * 几何约定（viewBox 400×500，1 米 = 10px）：
 *   塔顶 y=70（40m）· 地面 y=470（0m）· 横担 y=208（约 26m）· 接地刀闸 y=424（5m）
 * 模块 ID 的 bit0 决定装置在塔的哪一侧：0=小号侧（左），1=大号侧（右）。
 */

const CX = 200;
const TOP_Y = 70;
const BASE_Y = 470;
const ARM_Y = 208;
const ARM_LEFT = 52;
const ARM_RIGHT = 348;
const ROD_LEN = 100;
const LOCK_OFFSET = 113;
const PIN_LEN = 13;
const SWITCH_Y = 424;
/** 导电杆/减速器的旋转中心，比横担低一点，避免和横担梁重叠 */
const PIVOT_Y = ARM_Y + 12;

type Side = 'left' | 'right';

function Geometry() {
  return (
    <>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eff6ff" />
          <stop offset="60%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#eef2f7" />
        </linearGradient>
        <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="45%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <linearGradient id="motor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id="rod" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="50%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <radialGradient id="earth" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#cbd5e1" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="400" height="500" fill="url(#sky)" />
      <ellipse cx="200" cy="474" rx="150" ry="16" fill="url(#earth)" />
      <rect x="0" y="470" width="400" height="30" fill="#e2e8f0" />
      <line x1="0" y1="470" x2="400" y2="470" stroke="#94a3b8" strokeWidth="1.5" />
    </>
  );
}

function TowerFrame() {
  const ys = [70, 120, 170, 220, 270, 320, 370, 420, 470];
  const half = (y: number) => 24 + 40 * ((y - TOP_Y) / (BASE_Y - TOP_Y));
  const depth = 16;

  return (
    <g strokeLinecap="round">
      {/* 背面（表现厚度） */}
      <g stroke="#94a3b8" strokeWidth="2" opacity="0.65" fill="none">
        <line x1={CX - 24 + depth} y1={TOP_Y - 12} x2={CX - 64 + depth} y2={BASE_Y - 12} />
        <line x1={CX + 24 + depth} y1={TOP_Y - 12} x2={CX + 64 + depth} y2={BASE_Y - 12} />
        {ys.map((y) => (
          <line key={`bh-${y}`} x1={CX - half(y) + depth} y1={y - 12} x2={CX + half(y) + depth} y2={y - 12} />
        ))}
      </g>
      {/* 正面塔腿 */}
      <g stroke="url(#steel)" strokeWidth="4" fill="none">
        <line x1={CX - 24} y1={TOP_Y} x2={CX - 64} y2={BASE_Y} />
        <line x1={CX + 24} y1={TOP_Y} x2={CX + 64} y2={BASE_Y} />
      </g>
      {/* 横隔与交叉斜材 */}
      <g stroke="#94a3b8" strokeWidth="1.4" fill="none" opacity="0.9">
        {ys.map((y, i) => (
          <g key={`brace-${y}`}>
            <line x1={CX - half(y)} y1={y} x2={CX + half(y)} y2={y} />
            {i < ys.length - 1 ? (
              <>
                <line x1={CX - half(y)} y1={y} x2={CX + half(ys[i + 1])} y2={ys[i + 1]} />
                <line x1={CX + half(y)} y1={y} x2={CX - half(ys[i + 1])} y2={ys[i + 1]} />
              </>
            ) : null}
          </g>
        ))}
      </g>
      {/* 塔顶地线支架 */}
      <g stroke="#64748b" strokeWidth="3" fill="none">
        <line x1={CX - 24} y1={TOP_Y} x2={CX + 24} y2={TOP_Y} />
        <line x1={CX - 24} y1={TOP_Y} x2={CX - 10} y2={TOP_Y - 14} />
        <line x1={CX + 24} y1={TOP_Y} x2={CX + 10} y2={TOP_Y - 14} />
      </g>
      {/* 地线（左右各一根） */}
      <g stroke="#475569" strokeWidth="2" fill="none">
        <path d={`M ${CX - 10} ${TOP_Y - 14} Q 96 66 0 96`} />
        <path d={`M ${CX + 10} ${TOP_Y - 14} Q 304 66 400 96`} />
      </g>
      {/* 横担 */}
      <g>
        <polygon
          points={`${ARM_LEFT},${ARM_Y - 6} ${ARM_RIGHT},${ARM_Y - 6} ${ARM_RIGHT - 8},${ARM_Y + 6} ${ARM_LEFT + 8},${ARM_Y + 6}`}
          fill="url(#steel)"
        />
        <line x1={CX - 40} y1={ARM_Y - 6} x2={CX - 20} y2={ARM_Y - 60} stroke="#94a3b8" strokeWidth="2.5" />
        <line x1={CX + 40} y1={ARM_Y - 6} x2={CX + 20} y2={ARM_Y - 60} stroke="#94a3b8" strokeWidth="2.5" />
      </g>
      {/* 导线跳线（两侧都画，向外让开导电杆） */}
      <g stroke="#94a3b8" strokeWidth="2.6" fill="none">
        <path
          d={`M ${ARM_LEFT} ${ARM_Y + 4} C ${ARM_LEFT} 250 ${ARM_LEFT - 12} 274 ${ARM_LEFT - 12} 306 L ${ARM_LEFT - 12} 326`}
        />
        <path
          d={`M ${ARM_RIGHT} ${ARM_Y + 4} C ${ARM_RIGHT} 250 ${ARM_RIGHT + 12} 274 ${ARM_RIGHT + 12} 306 L ${ARM_RIGHT + 12} 326`}
        />
      </g>
      {/* 导电杆合闸时压在这里，把跳线与杆端环连起来 */}
      <g fill="#64748b">
        <rect x={ARM_LEFT - 12} y={315} width={19} height={6} rx={2} />
        <rect x={ARM_RIGHT - 7} y={315} width={19} height={6} rx={2} />
      </g>
      {/* 5m 高度标注 */}
      <g stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3">
        <line x1={CX - 92} y1={SWITCH_Y} x2={CX - 72} y2={SWITCH_Y} />
      </g>
      <text x={CX - 96} y={SWITCH_Y + 3} textAnchor="end" fontSize="8" fill="#94a3b8">
        5m
      </text>
    </g>
  );
}

/** 接地刀闸 / 选相刀闸：一小段母线上的一把刀 */
function DisconnectSwitch({
  x,
  label,
  closed,
  durationSec,
  pending,
  onClick,
}: {
  x: number;
  label: string;
  closed: boolean;
  durationSec: number;
  pending: boolean;
  onClick: () => void;
}) {
  const y = SWITCH_Y;
  const hingeX = x - 10;
  return (
    <g className="cursor-pointer" onClick={onClick}>
      <rect x={x - 16} y={y - 24} width={32} height={46} fill="transparent" />
      <rect x={x - 12} y={y + 10} width={24} height={4} rx={1.5} fill="#64748b" />
      <rect x={x - 12} y={y + 2} width={3.5} height={10} fill="#475569" />
      <rect x={x + 8.5} y={y + 2} width={3.5} height={10} fill="#475569" />
      <circle cx={hingeX} cy={y} r={2.2} fill="#334155" />
      <g
        style={{
          transform: `rotate(${closed ? 0 : -42}deg)`,
          transformOrigin: `${hingeX}px ${y}px`,
          transformBox: 'view-box',
          transition: `transform ${durationSec}s linear`,
        }}
      >
        <rect x={hingeX} y={y - 2} width={20} height={4} rx={2} fill={closed ? '#10b981' : '#f59e0b'} />
      </g>
      <circle cx={x + 10} cy={y} r={2} fill={closed ? '#10b981' : '#94a3b8'} />
      <text x={x} y={y + 26} textAnchor="middle" fontSize="7.5" fill="#64748b">
        {label}
      </text>
      {pending ? (
        <>
          <circle cx={x} cy={y - 18} r={3.5} fill="#f59e0b" />
          <circle cx={x} cy={y - 18} r={6} fill="none" stroke="#f59e0b" strokeWidth="1" opacity="0.5" />
        </>
      ) : null}
    </g>
  );
}

/** 融冰刀闸（电机 + 减速器 + 导电杆）与融冰锁（推杆电机 + 锁销） */
function IceAssembly({
  side,
  closed,
  locked,
  icePresent,
  lockPresent,
  icePending,
  lockPending,
  iceSec,
  lockSec,
  onIceClick,
  onLockClick,
}: {
  side: Side;
  closed: boolean;
  locked: boolean;
  icePresent: boolean;
  lockPresent: boolean;
  icePending: boolean;
  lockPending: boolean;
  iceSec: number;
  lockSec: number;
  onIceClick: () => void;
  onLockClick: () => void;
}) {
  const inward = side === 'left' ? 1 : -1;
  const x = side === 'left' ? ARM_LEFT : ARM_RIGHT;
  const lockX = x + LOCK_OFFSET * inward;
  const motorW = 26 * inward;
  const pinX = lockX - PIN_LEN * inward;
  // 分闸时导电杆水平指向塔身；合闸时竖直向下压到跳线上
  const rodAngle = closed ? 90 : 90 - 90 * inward;

  return (
    <g>
      {icePresent ? (
        <g className="cursor-pointer" onClick={onIceClick}>
          <rect x={x - 14} y={ARM_Y - 20} width={28} height={22} rx={3} fill="url(#motor)" />
          <rect x={x - 14} y={ARM_Y - 22} width={28} height={4} rx={2} fill="#c2410c" />
          <rect x={x - 5} y={ARM_Y} width={10} height={PIVOT_Y - ARM_Y} fill="#475569" />
          <circle cx={x} cy={PIVOT_Y} r={9} fill="#475569" />
          <circle cx={x} cy={PIVOT_Y} r={4} fill="#94a3b8" />
          <circle cx={x} cy={PIVOT_Y} r={12} fill="none" stroke="#f97316" strokeWidth="1.5" strokeDasharray="2 3" />
          <g
            style={{
              transform: `rotate(${rodAngle}deg)`,
              transformOrigin: `${x}px ${PIVOT_Y}px`,
              transformBox: 'view-box',
              transition: `transform ${iceSec}s linear`,
            }}
          >
            <rect
              x={x}
              y={PIVOT_Y - 3}
              width={ROD_LEN}
              height={6}
              rx={3}
              fill="url(#rod)"
              stroke="#b45309"
              strokeWidth="0.6"
            />
            <circle cx={x + ROD_LEN} cy={PIVOT_Y} r={5.5} fill="none" stroke="#f59e0b" strokeWidth="2" />
          </g>
          {icePending ? <circle cx={x} cy={ARM_Y - 30} r={3.5} fill="#f59e0b" /> : null}
        </g>
      ) : null}

      {lockPresent ? (
        <g className="cursor-pointer" onClick={onLockClick}>
          <rect
            x={Math.min(lockX, lockX + motorW)}
            y={ARM_Y - 2}
            width={26}
            height={20}
            rx={3}
            fill="#334155"
          />
          <rect x={Math.min(lockX, lockX + motorW) + 3} y={ARM_Y + 1} width={20} height={3} rx={1.5} fill="#64748b" />
          <g
            style={{
              transform: `scaleX(${locked ? 1 : 0.06})`,
              transformOrigin: `${lockX}px ${PIVOT_Y}px`,
              transformBox: 'view-box',
              transition: `transform ${lockSec}s ease-in-out`,
            }}
          >
            <rect
              x={Math.min(pinX, lockX)}
              y={PIVOT_Y - 3.5}
              width={Math.abs(lockX - pinX)}
              height={7}
              rx={3}
              fill="#e2e8f0"
              stroke="#475569"
              strokeWidth="0.8"
            />
            <circle cx={pinX} cy={PIVOT_Y} r={3.2} fill="#e2e8f0" stroke="#475569" strokeWidth="0.8" />
          </g>
          <circle cx={lockX} cy={PIVOT_Y} r={3} fill="#94a3b8" />
          {lockPending ? <circle cx={lockX} cy={ARM_Y - 10} r={3.5} fill="#f59e0b" /> : null}
        </g>
      ) : null}
    </g>
  );
}

const SWITCH_LABEL: Record<string, string> = {
  ground: '接地',
  ground2: '接地2',
  phase1: '选相1',
  phase2: '选相2',
  phase3: '选相3',
};

const CLOSED_STATES = new Set(['closed', 'closing']);
const LOCKED_STATES = new Set(['locked', 'locking']);

function ControlPair({
  label,
  left,
  right,
  active,
  onPick,
}: {
  label: string;
  left: { value: string; label: string };
  right: { value: string; label: string };
  active: string | undefined;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-[42px] shrink-0 text-[10px] text-slate-500">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-slate-200">
        {[left, right].map((opt) => {
          const on = active === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onPick(opt.value)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] transition-colors',
                on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function TowerView({ m, server }: { m: ModuleSnapshot; server: ServerConfig }) {
  const run = useStore((s) => s.run);
  const toast = useStore((s) => s.toast);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const side: Side = m.moduleId & 1 ? 'right' : 'left';
  const has = (key: string) => m.devices.includes(key);
  const stateOf = (key: string) => m.states[key];
  const pendingOf = (key: string) => m.pending.filter((p) => p.key === key);
  const autoOn = m.autoMode === 'on' || (m.autoMode === 'inherit' && server.autoModeDefault);

  const switchKeys = ['ground', 'ground2', 'phase1', 'phase2', 'phase3'].filter(has);
  const rowWidth = switchKeys.length * 34;
  const switchX = (key: string) => {
    const index = switchKeys.indexOf(key);
    return CX - rowWidth / 2 + 17 + index * 34;
  };

  const set = (key: string, value: string) =>
    void run(async () => {
      await api.setDevice(m.id, key, value);
    });

  const toggleSwitch = (key: string) => {
    const closed = CLOSED_STATES.has(stateOf(key) ?? '');
    set(key, closed ? 'open' : 'closed');
  };
  const toggleIce = () => {
    const closed = CLOSED_STATES.has(stateOf('ice') ?? '');
    set('ice', closed ? 'open' : 'closed');
  };
  const toggleLock = () => {
    const locked = LOCKED_STATES.has(stateOf('lock') ?? '');
    set('lock', locked ? 'unlocked' : 'locked');
  };

  const iceClosed = CLOSED_STATES.has(stateOf('ice') ?? '');
  const lockLocked = LOCKED_STATES.has(stateOf('lock') ?? '');
  const switchDur = ready ? server.animSwitchSec : 0;
  const lockDur = ready ? server.animLockSec : 0;
  const iceDur = ready ? server.animIceSec : 0;

  const linkTone =
    m.link === 'online'
      ? 'bg-emerald-500'
      : m.link === 'connecting'
        ? 'bg-amber-500'
        : m.link === 'offline'
          ? 'bg-rose-500'
          : 'bg-slate-300';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <span className={cn('size-1.5 shrink-0 rounded-full', linkTone)} />
        <span className="truncate text-[12px] font-medium text-slate-800">{m.towerName}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">#{m.moduleId}</span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px]',
            side === 'right' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600',
          )}
        >
          {side === 'right' ? '大号侧' : '小号侧'}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {autoOn ? (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">自动</span>
          ) : (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">手动</span>
          )}
          {m.pending.length ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
              {m.pending.length} 条待动作
            </span>
          ) : null}
        </span>
      </div>

      <div className="relative">
        <svg viewBox="0 0 400 500" className="block w-full select-none">
          <Geometry />
          <TowerFrame />
          <IceAssembly
            side={side}
            closed={iceClosed}
            locked={lockLocked}
            icePresent={has('ice')}
            lockPresent={has('lock')}
            icePending={pendingOf('ice').length > 0}
            lockPending={pendingOf('lock').length > 0}
            iceSec={iceDur}
            lockSec={lockDur}
            onIceClick={toggleIce}
            onLockClick={toggleLock}
          />
          <text
            x={side === 'left' ? 348 : 52}
            y={ARM_Y + 70}
            textAnchor="middle"
            fontSize="7.5"
            fill="#94a3b8"
            opacity="0.85"
          >
            该侧无本模块装置
          </text>
          <rect
            x={CX - rowWidth / 2 - 6}
            y={SWITCH_Y + 12}
            width={rowWidth + 12}
            height={5}
            rx={2}
            fill="#94a3b8"
            opacity="0.7"
          />
          {switchKeys.map((key) => (
            <DisconnectSwitch
              key={key}
              x={switchX(key)}
              label={SWITCH_LABEL[key] ?? deviceMeta(key).name}
              closed={CLOSED_STATES.has(stateOf(key) ?? '')}
              durationSec={switchDur}
              pending={pendingOf(key).length > 0}
              onClick={() => toggleSwitch(key)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-white/70 px-1.5 py-0.5 text-[9px] text-slate-500 backdrop-blur">
          点击设备可操作
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2">
        {switchKeys.map((key) => (
          <ControlPair
            key={key}
            label={SWITCH_LABEL[key] ?? key}
            left={{ value: 'closed', label: '合' }}
            right={{ value: 'open', label: '分' }}
            active={stateOf(key)}
            onPick={(v) => set(key, v)}
          />
        ))}
        {has('lock') ? (
          <ControlPair
            label="融冰锁"
            left={{ value: 'locked', label: '闭锁' }}
            right={{ value: 'unlocked', label: '开锁' }}
            active={stateOf('lock')}
            onPick={(v) => set('lock', v)}
          />
        ) : null}
        {has('ice') ? (
          <ControlPair
            label="融冰刀闸"
            left={{ value: 'closed', label: '合' }}
            right={{ value: 'open', label: '分' }}
            active={stateOf('ice')}
            onPick={(v) => set('ice', v)}
          />
        ) : null}
        {has('activation') ? (
          <ControlPair
            label="活化"
            left={{ value: 'on', label: '开' }}
            right={{ value: 'off', label: '关' }}
            active={stateOf('activation')}
            onPick={(v) => set('activation', v)}
          />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-emerald-700 hover:bg-emerald-50"
            onClick={() =>
              void run(async () => {
                await api.preset(m.id, 'initial');
                toast('已切换到初始态');
              })
            }
          >
            初始态
          </button>
          <button
            className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-rose-700 hover:bg-rose-50"
            onClick={() =>
              void run(async () => {
                await api.preset(m.id, 'melt');
                toast('已切换到融冰态');
              })
            }
          >
            融冰态
          </button>
        </div>
      </div>

      {m.pending.length ? (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2">
          <div className="mb-1 text-[10px] font-medium text-amber-800">
            收到平台指令{autoOn ? '（自动模式，动画会自动执行）' : '（手动模式，点按钮或直接点塔上设备）'}
          </div>
          <div className="space-y-1">
            {m.pending.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <span className="flex-1 text-[11px] text-amber-900">
                  {deviceMeta(p.key).name} → {p.label}
                </span>
                <button
                  className="rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white"
                  onClick={() =>
                    void run(async () => {
                      await api.pending(m.id, p.id, 'confirm');
                      toast(`${deviceMeta(p.key).name} 已到位`);
                    })
                  }
                >
                  已到位
                </button>
                <button
                  className="rounded px-2 py-0.5 text-[10px] text-amber-800 hover:bg-amber-100"
                  onClick={() => void run(() => api.pending(m.id, p.id, 'dismiss'))}
                >
                  忽略
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
