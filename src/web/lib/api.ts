import type { AppState, FrameEntry, ModuleConfig, ModuleSnapshot, ServerConfig } from '@/core/types';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* 忽略非 JSON 响应 */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export type CreateModuleInput = {
  protocol?: 'mg400' | 'mg500';
  towerName?: string;
  moduleId: number;
  phaseCount?: number;
  devices?: string[];
  states?: Record<string, string>;
  telemetry?: ModuleConfig['telemetry'];
  autoConnect?: boolean;
};

export const api = {
  getState: () => req<AppState>('GET', '/api/state'),
  getFrames: (moduleId?: string, limit = 200) =>
    req<FrameEntry[]>('GET', `/api/frames?limit=${limit}${moduleId ? `&moduleId=${moduleId}` : ''}`),
  updateServer: (patch: Partial<ServerConfig>) => req<ServerConfig>('PUT', '/api/server', patch),
  createModule: (input: CreateModuleInput) => req<ModuleSnapshot>('POST', '/api/modules', input),
  updateModule: (id: string, patch: Partial<ModuleConfig>) =>
    req<ModuleSnapshot>('PATCH', `/api/modules/${id}`, patch),
  deleteModule: (id: string) => req<{ ok: boolean }>('DELETE', `/api/modules/${id}`),
  link: (id: string, action: 'connect' | 'disconnect' | 'reconnect') =>
    req<{ ok: boolean }>('POST', `/api/modules/${id}/${action}`),
  setDevice: (id: string, key: string, state: string) =>
    req<{ ok: boolean }>('POST', `/api/modules/${id}/devices/${key}`, { state }),
  pending: (id: string, pendingId: string, action: 'confirm' | 'dismiss') =>
    req<{ ok: boolean }>('POST', `/api/modules/${id}/pending/${pendingId}`, { action }),
  telemetry: (id: string, patch: Partial<ModuleConfig['telemetry']>) =>
    req<{ ok: boolean }>('POST', `/api/modules/${id}/telemetry`, patch),
  preset: (id: string, preset: 'initial' | 'melt') =>
    req<{ ok: boolean }>('POST', `/api/modules/${id}/preset`, { preset }),
  report: (id: string, includePower = false) =>
    req<{ ok: boolean }>('POST', `/api/modules/${id}/report`, { includePower }),
  send: (id: string, payload: { hex?: string; type?: number; dataHex?: string; moduleId?: number }) =>
    req<{ ok: boolean; hex: string }>('POST', `/api/modules/${id}/send`, payload),
  exportConfig: () => req<unknown>('GET', '/api/config/export'),
  importConfig: (data: { server?: ServerConfig; modules?: ModuleConfig[] }) =>
    req<{ ok: boolean; count: number }>('POST', '/api/config/import', data),
};
