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

export type SessionPage = {
  idx: number;
  url: string;
  title: string;
  entered_at: number;
  left_at: number;
};

export type SessionFilter = {
  browser?: string;
  os?: string;
  device?: string;
  country?: string;
  url?: string;
  action?: string; // matches custom events, page visits, and browser logs in the session
  identity?: string; // matches userId / clientId / remoteId
  min_duration_ms?: number;
};
