export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type LogSettings = {
  enabled: boolean;
  severities?: LogSeverity[];
  /** Kept for compatibility with older dashboards and trackers. */
  minimum_severity?: LogSeverity;
  retention_days: number; // 0 = no time-based cap
  max_rows: number; // 0 = no row cap
};

export type Log = {
  id: number;
  session_id: string;
  site_id: number;
  site_name?: string;
  service_id?: number;
  service_name?: string;
  environment?: string;
  timestamp_ms: number;
  severity: LogSeverity;
  message: string;
  extra?: string;
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
  serviceId?: number | null;
  environment?: string;
  severity?: LogSeverity | LogSeverity[] | '';
  search?: string;
  searchIn?: 'message' | 'extra' | 'both';
  sessionId?: string;
  beforeId?: number;
  fromMs?: number;
  toMs?: number;
  limit?: number;
};

export type LogFilterOptions = {
  services: Array<{ id: number; site_id: number; name: string }>;
  environments: string[];
};
