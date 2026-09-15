export type PerformanceStats = {
  requests: number;
  errors: number;
  error_rate: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

export type PerformanceKey = {
  id: number;
  key_hint: string;
  created_at: number;
  last_used_at: number;
};

export type PerformanceSeriesPoint = {
  bucket_start: number;
  requests: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

export type PerformanceEndpoint = PerformanceStats & {
  site_id: number;
  site_name?: string;
  endpoint: string;
  environment: string;
  service: string;
  version: string;
  series: PerformanceSeriesPoint[];
};

export type PerformanceReport = {
  from: number;
  to: number;
  summary: PerformanceStats;
  endpoints: PerformanceEndpoint[];
  filters: {
    environments: string[];
    services: string[];
    versions: string[];
  };
};

export type PerformanceQuery = {
  siteId?: number | null;
  environment?: string;
  service?: string;
  version?: string;
  from?: number;
  to?: number;
  limit?: number;
};
