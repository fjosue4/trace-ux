import { request } from '../client';
import { CustomEvent, Session, SessionFilter, SessionPage, SharedSession } from '../types/sessions';
import { Log, SharedLog } from '../types/logs';

export const sessionsEndpoints = {
  // siteId === null lists sessions across all sites (rows carry site_name).
  listSessions: (siteId: number | null, f: SessionFilter = {}) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (f.browser) q.set('browser', f.browser);
    if (f.os) q.set('os', f.os);
    if (f.device) q.set('device', f.device);
    if (f.country) q.set('country', f.country);
    if (f.url) q.set('url', f.url);
    if (f.action) q.set('action', f.action);
    if (f.identity) q.set('visitor', f.identity);
    if (f.min_duration_ms) q.set('min_duration_ms', String(f.min_duration_ms));
    return request<Session[]>(`/api/sessions?${q}`);
  },

  listSessionCountries: (siteId: number | null) =>
    request<string[]>(`/api/sessions/countries${siteId ? `?site_id=${siteId}` : ''}`),

  getSession: (id: string) =>
    request<{ session: Session; pages: SessionPage[]; custom_events: CustomEvent[]; logs: Log[] }>(
      `/api/sessions/${id}`,
    ),

  // In-progress vs completed counts (optional per-site scope).
  sessionStats: (siteId: number | null) =>
    request<{ active: number; completed: number }>(
      `/api/sessions/stats${siteId ? `?site_id=${siteId}` : ''}`,
    ),

  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),

  getEvents: (id: string, afterSeq: number) =>
    request<{ next_seq: number; has_more: boolean; events: unknown[] }>(
      `/api/sessions/${id}/events?after_seq=${afterSeq}&max_events=400`,
    ),

  getSharedSession: (token: string) =>
    request<{ session: SharedSession; custom_events: CustomEvent[]; logs: SharedLog[] }>(
      `/api/demo/replay/${encodeURIComponent(token)}`,
    ),
  getSharedEvents: (token: string, afterSeq: number) =>
    request<{ next_seq: number; has_more: boolean; events: unknown[] }>(
      `/api/demo/replay/${encodeURIComponent(token)}/events?after_seq=${afterSeq}&max_events=400`,
    ),
};
