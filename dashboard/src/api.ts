// Typed helpers around the dashboard API. All calls are same-origin.

export type Site = {
  id: number;
  name: string;
  site_key: string;
  created_at: number;
  session_count: number;
};

export type Session = {
  id: string;
  site_id: number;
  started_at: number;
  last_seen: number;
  duration_ms: number;
  page_count: number;
  event_count: number;
  initial_url: string;
  exit_url: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  browser: string;
  os: string;
  device: string;
  viewport_w: number;
  viewport_h: number;
  screen_w: number;
  screen_h: number;
};

export type SessionPage = {
  idx: number;
  url: string;
  title: string;
  entered_at: number;
  left_at: number;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (res.status === 401) {
    throw new ApiError(401, 'unauthorized');
  }
  if (!res.ok) {
    let msg = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ authenticated: boolean }>('/api/auth/me'),
  login: (password: string) =>
    request<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  listSites: () => request<Site[]>('/api/sites'),
  createSite: (name: string) =>
    request<Site>('/api/sites', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteSite: (id: number) => request<{ ok: boolean }>(`/api/sites/${id}`, { method: 'DELETE' }),

  listSessions: (siteId: number, f: SessionFilter = {}) => {
    const q = new URLSearchParams({ site_id: String(siteId) });
    if (f.browser) q.set('browser', f.browser);
    if (f.os) q.set('os', f.os);
    if (f.device) q.set('device', f.device);
    if (f.url) q.set('url', f.url);
    if (f.min_duration_ms) q.set('min_duration_ms', String(f.min_duration_ms));
    return request<Session[]>(`/api/sessions?${q}`);
  },

  getSession: (id: string) =>
    request<{ session: Session; pages: SessionPage[] }>(`/api/sessions/${id}`),

  getEvents: (id: string, afterSeq: number) =>
    request<{ next_seq: number; has_more: boolean; events: unknown[] }>(
      `/api/sessions/${id}/events?after_seq=${afterSeq}&max_events=400`,
    ),
};

export type SessionFilter = {
  browser?: string;
  os?: string;
  device?: string;
  url?: string;
  min_duration_ms?: number;
};

// ---- formatting helpers ----

export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function fmtTime(unix: number): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtClock(unix: number): string {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
