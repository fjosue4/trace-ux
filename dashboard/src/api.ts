// Typed helpers around the dashboard API. All calls are same-origin.

export type Site = {
  id: number;
  name: string;
  url: string;
  site_key: string;
  created_at: number;
  session_count: number;
  recording_enabled?: boolean;
  settings?: SiteSettings;
};

// Per-site configuration, managed in the dashboard and served to the tracker
// via the public config endpoint.
export type SurveyQuestion = {
  id: string;
  label: string;
  type: 'rating' | 'text' | 'choice';
  max?: number; // rating scale: 5 (stars) or 10 (NPS)
  options?: string[];
  optional?: boolean;
};

export type SiteAppearance = {
  button_bg?: string;
  button_text?: string;
  button_label?: string;
  panel_bg?: string;
  panel_text?: string;
  accent?: string;
  primary?: string;
  primary_text?: string;
  radius?: number;
  spacing?: number;
};

// When does the feedback widget show up for a visitor?
export type FeedbackTrigger = {
  mode: 'always' | 'page' | 'action';
  pages?: string[]; // URL patterns with * wildcards
  actions?: string[]; // trace-ux-track-id names / window.TraceUX.track names
};

export type SiteSettings = {
  feedback_enabled: boolean;
  feedback_position: string; // right | left
  survey_id: string;
  survey_title: string;
  survey_type: string; // stars | nps | custom
  // Recordings (server-enforced):
  max_concurrent_sessions: number; // 0 = no limit
  retention_sessions_days: number; // 0 = server default
  retention_feedback_days: number; // 0 = server default
  allow_delete_recordings: boolean;
  logs: LogSettings;
  questions?: SurveyQuestion[];
  appearance?: SiteAppearance;
  feedback_trigger?: FeedbackTrigger;
};

export type SiteStats = {
  feedback_count: number;
  avg_rating: number;
  positive_pct: number;
};

// Server resource report (admin only, /api/system/health). OS-level figures
  // come from /proc and statfs on the VPS; trace_ux_* fields are the process's
// own share.
export type SystemHealth = {
  ram: {
    total_bytes: number;
    used_bytes: number;
    available_bytes: number;
    trace_ux_bytes: number;
    mem_limit_bytes: number; // GOMEMLIMIT soft cap, 0 = unset
  };
  cpu: {
    cores: number;
    load1: number;
    load5: number;
    load15: number;
    trace_ux_pct: number;
    uptime_seconds: number;
  };
  disk: {
    total_bytes: number;
    free_bytes: number;
    trace_ux_bytes: number;
    data_dir: string;
  };
  store: { sites: number; sessions: number; feedback: number };
};

export type SiteDetail = {
  site: Site;
  sessions: Session[];
  feedback: Feedback[];
  stats: SiteStats;
};

export type Session = {
  id: string;
  site_id: number;
  site_name?: string; // present when listing across all sites
  started_at: number;
  last_seen: number;
  active?: boolean; // in-progress (seen in the last 30 minutes)
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
  country: string;
  viewport_w: number;
  viewport_h: number;
  screen_w: number;
  screen_h: number;
  user_id?: string;
  client_id?: string;
  remote_id?: string;
};

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type LogSettings = {
  enabled: boolean;
  minimum_severity: LogSeverity;
  retention_days: number; // 0 = no time-based cap
  max_rows: number; // 0 = no row cap
};

export type SharedSession = Pick<
  Session,
  'id' | 'started_at' | 'last_seen' | 'duration_ms' | 'page_count' | 'event_count' | 'viewport_w' | 'viewport_h'
>;

// A tracked activity moment (trace-ux-track-id click or window.TraceUX.track()).
export type CustomEvent = {
  ts: number; // unix millis, visitor's clock
  name: string;
  track_id: string;
};

// Visitor feedback / survey response (rating 1-5 = stars, 0-10 = NPS-style).
export type Feedback = {
  id: number;
  site_id: number;
  site_name?: string;
  session_id?: string;
  survey_id: string;
  rating: number;
  comment: string;
  answers?: { id: string; label?: string; value: string }[];
  created_at: number;
  browser?: string;
  os?: string;
  device?: string;
};

export type FeedbackSummary = {
  survey_id: string;
  count: number;
  average: number;
};

export type Log = {
  id: number;
  session_id: string;
  site_id: number;
  site_name?: string;
  timestamp_ms: number;
  severity: LogSeverity;
  message: string;
  url: string;
  created_at: number;
  session_started_at: number;
};

// The public demo replay exposes only the fields needed by its action feed.
export type SharedLog = Pick<Log, 'id' | 'timestamp_ms' | 'severity' | 'message' | 'url'>;

export type LogStats = {
  total: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
};

export type LogQuery = {
  siteId?: number | null;
  severity?: LogSeverity | '';
  sessionId?: string;
  beforeId?: number;
  fromMs?: number;
  toMs?: number;
  limit?: number;
};

export type SessionPage = {
  idx: number;
  url: string;
  title: string;
  entered_at: number;
  left_at: number;
};

export type Role = 'admin' | 'viewer';

export type CurrentUser = {
  username: string;
  role: Role;
};

export type User = {
  id: number;
  username: string;
  role: Role;
  created_at: number;
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
  me: () => request<CurrentUser>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),

  listUsers: () => request<User[]>('/api/users'),
  createUser: (username: string, password: string, role: Role) =>
    request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }),
  updateUser: (id: number, patch: { password?: string; role?: Role }) =>
    request<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  listSites: () => request<Site[]>('/api/sites'),
  createSite: (name: string, url: string) =>
    request<Site>('/api/sites', { method: 'POST', body: JSON.stringify({ name, url }) }),
  deleteSite: (id: number) => request<{ ok: boolean }>(`/api/sites/${id}`, { method: 'DELETE' }),

  // siteId === null lists sessions across all sites (rows carry site_name).
  listSessions: (siteId: number | null, f: SessionFilter = {}) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (f.browser) q.set('browser', f.browser);
    if (f.os) q.set('os', f.os);
    if (f.device) q.set('device', f.device);
    if (f.country) q.set('country', f.country);
    if (f.url) q.set('url', f.url);
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

  listLogs: (query: LogQuery = {}) => {
    const q = new URLSearchParams();
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (query.severity) q.set('severity', query.severity);
    if (query.sessionId) q.set('session_id', query.sessionId);
    if (query.beforeId) q.set('before_id', String(query.beforeId));
    if (query.fromMs) q.set('from_ms', String(query.fromMs));
    if (query.toMs) q.set('to_ms', String(query.toMs));
    q.set('limit', String(query.limit ?? 1000));
    return request<Log[]>(`/api/logs?${q.toString()}`);
  },

  logStats: (query: Pick<LogQuery, 'siteId' | 'fromMs' | 'toMs'> = {}) => {
    const q = new URLSearchParams();
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (query.fromMs) q.set('from_ms', String(query.fromMs));
    if (query.toMs) q.set('to_ms', String(query.toMs));
    const suffix = q.toString();
    return request<LogStats>(`/api/logs/stats${suffix ? `?${suffix}` : ''}`);
  },

  getSharedSession: (token: string) =>
    request<{ session: SharedSession; custom_events: CustomEvent[]; logs: SharedLog[] }>(
      `/api/demo/replay/${encodeURIComponent(token)}`,
    ),
  getSharedEvents: (token: string, afterSeq: number) =>
    request<{ next_seq: number; has_more: boolean; events: unknown[] }>(
      `/api/demo/replay/${encodeURIComponent(token)}/events?after_seq=${afterSeq}&max_events=400`,
    ),

  // Site management.
  getSiteDetail: (id: number) => request<SiteDetail>(`/api/sites/${id}`),
  updateSiteRecording: (id: number, enabled: boolean) =>
    request<{ ok: boolean; recording_enabled: boolean }>(`/api/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ recording_enabled: enabled }),
    }),
  updateSiteURL: (id: number, url: string) =>
    request<{ ok: boolean; url: string }>(`/api/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ url }),
    }),
  updateSiteSettings: (id: number, settings: SiteSettings) =>
    request<SiteSettings>(`/api/sites/${id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // Server health (admin only).
  getSystemHealth: () => request<SystemHealth>('/api/system/health'),

  // Feedback & surveys.
  listFeedback: (siteId: number | null, surveyId: string) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (surveyId) q.set('survey_id', surveyId);
    return request<Feedback[]>(`/api/feedback?${q}`);
  },
  feedbackSummary: (siteId: number | null, surveyId: string) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (surveyId) q.set('survey_id', surveyId);
    return request<FeedbackSummary[]>(`/api/feedback/summary?${q}`);
  },
  deleteFeedback: (id: number) =>
    request<{ ok: boolean }>(`/api/feedback/${id}`, { method: 'DELETE' }),
};

export type SessionFilter = {
  browser?: string;
  os?: string;
  device?: string;
  country?: string;
  url?: string;
  identity?: string; // matches userId / clientId / remoteId
  min_duration_ms?: number;
};
