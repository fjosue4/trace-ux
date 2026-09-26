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

export type SearchIndexStatus = {
  state: 'off' | 'building' | 'ready' | 'dropping';
  enabled: boolean;
  sessions_done: number;
  sessions_total: number;
  bytes: number;
  bytes_freed: number;
  started_at: number;
  eta_seconds: number;
  reason: '' | 'manual' | 'low_disk';
  reason_at: number;
  overflowed: boolean;
  error: string;
};
