import type { ModelId, ResearchMode, Effort } from '../shared/models';
import type {
  AppConfigDTO,
  AttachmentDTO,
  CreateResearchInput,
  GraphDTO,
  ModelCatalogItemDTO,
  PreferencesDTO,
  ResearchAcceptedDTO,
  ResearchEvent,
  SessionDetailDTO,
  SessionSummaryDTO,
  ShareDTO,
  ShareSnapshotDTO,
  UpdateGraphInput,
  UpdatePreferencesInput,
  UpdateSessionInput,
  UsageDTO,
} from '../shared/types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'api_error',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the Kairo server. Is it running?', 'network_error');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const errorBody = body as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(
      response.status,
      errorBody?.error?.message ?? `Request failed (${response.status}).`,
      errorBody?.error?.code ?? 'api_error',
    );
  }
  return body as T;
}

export const api = {
  getConfig: () => request<{ config: AppConfigDTO }>('/api/config'),
  getModels: () => request<{ models: ModelCatalogItemDTO[] }>('/api/models'),
  getPreferences: () => request<{ preferences: PreferencesDTO }>('/api/preferences'),
  updatePreferences: (patch: UpdatePreferencesInput) =>
    request<{ preferences: PreferencesDTO }>('/api/preferences', { method: 'PUT', body: JSON.stringify(patch) }),
  listSessions: () => request<{ sessions: SessionSummaryDTO[] }>('/api/sessions', { cache: 'no-store' }),
  getSession: (id: string) => request<{ session: SessionDetailDTO }>(`/api/sessions/${encodeURIComponent(id)}`),
  updateSession: (id: string, patch: UpdateSessionInput) =>
    request<{ session: SessionDetailDTO }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteSession: (id: string) =>
    request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createResearch: (input: CreateResearchInput) =>
    request<ResearchAcceptedDTO>('/api/research', { method: 'POST', body: JSON.stringify(input) }),
  rerun: (id: string, patch: { modelId?: ModelId; mode?: ResearchMode; effort?: Effort; verify?: boolean }) =>
    request<ResearchAcceptedDTO>(`/api/research/${encodeURIComponent(id)}/rerun`, {
      method: 'POST',
      body: JSON.stringify(patch),
    }),
  followup: (
    id: string,
    input: { query: string; modelId?: ModelId; mode?: ResearchMode; effort?: Effort; verify?: boolean },
  ) =>
    request<ResearchAcceptedDTO>(`/api/research/${encodeURIComponent(id)}/followup`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancel: (id: string) =>
    request<{ ok: boolean }>(`/api/research/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  getGraph: (id: string) => request<{ graph: GraphDTO }>(`/api/sessions/${encodeURIComponent(id)}/graph`),
  saveGraph: (id: string, input: UpdateGraphInput) =>
    request<{ graph: GraphDTO }>(`/api/sessions/${encodeURIComponent(id)}/graph`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  resetGraph: (id: string) =>
    request<{ graph: GraphDTO }>(`/api/sessions/${encodeURIComponent(id)}/graph/reset`, { method: 'POST' }),
  uploadAttachment: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<{ attachment: AttachmentDTO }>('/api/attachments', { method: 'POST', body: form });
  },
  deleteAttachment: (id: string) =>
    request<void>(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createShare: (id: string) =>
    request<{ share: ShareDTO }>(`/api/sessions/${encodeURIComponent(id)}/share`, { method: 'POST' }),
  revokeShare: (id: string, token: string) =>
    request<void>(`/api/sessions/${encodeURIComponent(id)}/share/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    }),
  getShare: (token: string) => request<{ snapshot: ShareSnapshotDTO }>(`/api/share/${encodeURIComponent(token)}`),
  getUsage: () => request<{ usage: UsageDTO }>('/api/usage'),
  reset: () => request<{ preferences: PreferencesDTO }>('/api/reset', { method: 'POST' }),
  exportUrl: (id: string, format: 'md' | 'json') =>
    `${API_BASE}/api/sessions/${encodeURIComponent(id)}/export?format=${format}`,
};

export type ResearchHandlers = {
  [K in ResearchEvent['type']]?: (event: Extract<ResearchEvent, { type: K }>) => void;
};

export interface ResearchSubscription {
  close: () => void;
}

export function subscribeToResearch(sessionId: string, handlers: ResearchHandlers): ResearchSubscription {
  const source = new EventSource(`${API_BASE}/api/research/${encodeURIComponent(sessionId)}/events`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  const bind = <K extends ResearchEvent['type']>(type: K) => {
    source.addEventListener(type, event => {
      if (closed) return;
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as Extract<ResearchEvent, { type: K }>;
        handlers[type]?.(parsed);
        if (type === 'done' || type === 'error') close();
      } catch {
        // Ignore malformed frames; EventSource will continue.
      }
    });
  };
  bind('stage');
  bind('sources');
  bind('claims');
  bind('delta');
  bind('usage');
  bind('done');
  bind('error');
  source.onerror = () => {
    if (closed || source.readyState !== EventSource.CLOSED) return;
    handlers.error?.({ type: 'error', message: 'Lost the connection to the research stream.' });
    close();
  };
  return { close };
}
