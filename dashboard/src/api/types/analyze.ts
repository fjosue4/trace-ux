import { LogSeverity } from './logs';

export type AnalyzeSource = 'event' | 'log';
export type AnalyzeVisibility = 'team' | 'private';
export type AnalyzeScope = 'all' | 'mine' | 'team';
export type AnalyzeVisualization = 'bar' | 'line';
/** Bucket size. Derived from the window: 5 minutes up to 6 hours, hourly up
 *  to a week of hours, calendar days otherwise. */
export type AnalyzeInterval = 'day' | 'hour' | '5min';
/** exact: case-sensitive equality. contains: case-insensitive substring,
 *  like the Logs page search. Omitted on reports saved before contains. */
export type AnalyzeMessageMode = 'exact' | 'contains';

/** Exact-match rule. Action reports use name/track_id; log reports use the rest. */
export type AnalyzeMatch = {
  name?: string;
  track_id?: string;
  message?: string;
  message_mode?: AnalyzeMessageMode;
  severity?: LogSeverity;
  service_id?: number;
  environment?: string;
};

export type AnalyzeDefinition = {
  version: 1;
  source: AnalyzeSource;
  /** null means All sites. */
  site_id: number | null;
  metric: 'occurrences';
  match: AnalyzeMatch;
  /** Exactly one of default_days and default_hours is set. */
  default_days?: number;
  default_hours?: number;
  interval: AnalyzeInterval;
  /** IANA zone that sets the day boundaries every viewer sees. */
  timezone: string;
  visualization: AnalyzeVisualization;
};

export type AnalyzeReport = {
  id: number;
  name: string;
  description: string;
  visibility: AnalyzeVisibility;
  source: AnalyzeSource;
  site_id: number | null;
  site_name?: string;
  owner: { id: number; username: string };
  /** True only for the owner; the server enforces it on every write. */
  can_edit: boolean;
  definition: AnalyzeDefinition;
  created_at: number;
  updated_at: number;
};

export type AnalyzeReportInput = {
  name: string;
  description: string;
  visibility: AnalyzeVisibility;
  definition: AnalyzeDefinition;
};

export type AnalyzePoint = {
  /** Start of the bucket (local midnight, hour, or 5 minutes), epoch ms. */
  bucket_start: number;
  count: number;
  /** The day starts before retained data does, so its count is a lower bound. */
  incomplete?: boolean;
};

export type AnalyzeWarning = { code: string; message: string };

export type AnalyzeResult = {
  from: number;
  to: number;
  timezone: string;
  interval: AnalyzeInterval;
  buckets: number;
  total: number;
  /** Per bucket of `interval`. */
  average: number;
  /** Equal to `from` unless retention removed the start of the range. */
  available_from: number;
  series: AnalyzePoint[];
  warnings: AnalyzeWarning[];
};

/** A rolling number of hours or days, or YYYY-MM-DD dates with an exclusive end. */
export type AnalyzeRange = { hours?: number; days?: number; from?: string; to?: string };

export type AnalyzeEventOption = { name: string; track_id: string; count: number; last_seen_ms: number };
/** truncated: only the opening of a longer log; usable with contains only. */
export type AnalyzeLogOption = { message: string; truncated?: boolean; severity: LogSeverity; count: number; last_seen_ms: number };

export type AnalyzeListQuery = {
  scope?: AnalyzeScope;
  siteId?: number | null;
  source?: AnalyzeSource | null;
};
