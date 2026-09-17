export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type LogSettings = {
  enabled: boolean;
  minimum_severity: LogSeverity;
  retention_days: number; // 0 = no time-based cap
  max_rows: number; // 0 = no row cap
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
  severity?: LogSeverity | LogSeverity[] | '';
  sessionId?: string;
  beforeId?: number;
  fromMs?: number;
  toMs?: number;
  limit?: number;
};
