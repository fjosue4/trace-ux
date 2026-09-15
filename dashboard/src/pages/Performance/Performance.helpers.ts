import { PerformanceEndpoint } from '../../api';
import { fmtClock, fmtTime } from '../../lib/format';
import { TimeRange } from './Performance.types';

export function endpointKey(endpoint: PerformanceEndpoint): string {
  return [endpoint.site_id, endpoint.endpoint, endpoint.environment, endpoint.service, endpoint.version].join('|');
}

export function fmtLatency(ms: number): string {
  if (!ms) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  return `${ms.toFixed(ms >= 100 ? 0 : 1)}ms`;
}

export function fmtNumber(value: number): string {
  return value.toLocaleString();
}

export function timeBounds(range: TimeRange): { from?: number; to: number } {
  const to = Math.floor(Date.now() / 1000);
  const seconds: Partial<Record<TimeRange, number>> = {
    '1h': 60 * 60,
    '6h': 6 * 60 * 60,
    '24h': 24 * 60 * 60,
    '7d': 7 * 24 * 60 * 60,
  };
  const duration = seconds[range];
  return { from: duration ? to - duration : undefined, to };
}

export function chartTime(unix: number, range: TimeRange): string {
  if (range === '1h' || range === '6h') return fmtClock(unix);
  return fmtTime(unix).replace(/,? \d{1,2}:\d{2}.*$/, '');
}
