import { Log, LogSeverity } from '../../api';
import { TimeRange, TimeWindow } from './Logs.types';

export function severityTone(severity: LogSeverity): 'accent' | 'neutral' | 'danger' {
  return severity === 'error' ? 'danger' : severity === 'warn' ? 'accent' : 'neutral';
}

export function logTimestamp(log: Log): number {
  return Math.floor(log.timestamp_ms / 1000) || log.created_at;
}

export function parseDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveTimeWindow(range: TimeRange, customFrom: string, customTo: string): TimeWindow {
  const now = Date.now();
  const durations: Partial<Record<TimeRange, number>> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  if (range === 'all') return { valid: true };
  if (range === 'custom') {
    const fromMs = parseDateInput(customFrom);
    const toMs = parseDateInput(customTo);
    if (customFrom && fromMs === undefined) return { valid: false, error: 'Choose a valid start time.' };
    if (customTo && toMs === undefined) return { valid: false, error: 'Choose a valid end time.' };
    if (fromMs && toMs && fromMs > toMs) {
      return { valid: false, error: 'The start time must be before the end time.' };
    }
    return { fromMs, toMs, valid: true };
  }
  return { fromMs: now - (durations[range] ?? durations['15m']!), toMs: now, valid: true };
}
