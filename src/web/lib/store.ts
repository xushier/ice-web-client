import { create } from 'zustand';
import type { AppState, FrameEntry } from '@/core/types';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface Store {
  state: AppState | null;
  frames: FrameEntry[];
  ws: 'connecting' | 'open' | 'closed';
  toasts: Toast[];
  init: () => void;
  toast: (text: string, kind?: 'info' | 'error') => void;
  dismissToast: (id: number) => void;
  clearFrames: () => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}

let socket: WebSocket | null = null;
let retry = 0;
let started = false;
let toastSeq = 0;

export const useStore = create<Store>((set, get) => ({
  state: null,
  frames: [],
  ws: 'connecting',
  toasts: [],

  init: () => {
    if (started) return;
    started = true;
    connect();
  },

  toast: (text, kind = 'info') => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 5200 : 2600);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  clearFrames: () => set({ frames: [] }),

  run: async (fn) => {
    try {
      await fn();
    } catch (err) {
      get().toast((err as Error).message, 'error');
    }
  },
}));

function connect(): void {
  const store = useStore.getState();
  store.ws !== 'connecting' && useStore.setState({ ws: 'connecting' });
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;

  ws.onopen = () => {
    retry = 0;
    useStore.setState({ ws: 'open' });
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data as string) as
      | { type: 'state'; state: AppState }
      | { type: 'frames'; frames: FrameEntry[] }
      | { type: 'frame'; frame: FrameEntry };

    if (msg.type === 'state') useStore.setState({ state: msg.state });
    if (msg.type === 'frames') useStore.setState({ frames: [...msg.frames].reverse() });
    if (msg.type === 'frame') {
      const frames = [msg.frame, ...useStore.getState().frames];
      useStore.setState({ frames: frames.slice(0, 500) });
    }
  };

  ws.onclose = () => {
    useStore.setState({ ws: 'closed' });
    if (socket === ws) socket = null;
    const delay = Math.min(5000, 400 * 2 ** Math.min(retry, 4));
    retry += 1;
    setTimeout(() => {
      if (!socket) connect();
    }, delay);
  };

  ws.onerror = () => ws.close();
}
