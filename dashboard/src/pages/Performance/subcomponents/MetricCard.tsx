import type { PerformanceStats } from '../../../api';
import type { StatStripItem } from '../../../components/ui/StatStrip';
import { fmtLatency, fmtNumber } from '../Performance.helpers';

// The five summary figures shown above a performance view, as StatStrip
// items. Used for the whole report and for a single endpoint's detail.
export function metricItems(stats: PerformanceStats): StatStripItem[] {
  return [
    { label: 'Requests', value: fmtNumber(stats.requests), detail: `${fmtNumber(stats.errors)} errors` },
    {
      label: 'Error rate',
      value: `${stats.error_rate.toFixed(1)}%`,
      detail: `Average ${fmtLatency(stats.avg_ms)}`,
      tone: stats.error_rate > 0 ? 'danger' : undefined,
    },
    { label: 'p50', value: fmtLatency(stats.p50_ms), detail: 'Typical request' },
    { label: 'p95', value: fmtLatency(stats.p95_ms), detail: 'Slow-tail latency' },
    { label: 'p99', value: fmtLatency(stats.p99_ms), detail: 'Worst-tail latency' },
  ];
}
