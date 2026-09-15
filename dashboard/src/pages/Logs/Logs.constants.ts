import { TimeRange } from './Logs.types';

export const MAX_VISIBLE_LOGS = 1000;
export const LIVE_REFRESH_MS = 5000;

export const severityOptions = [
  { value: 'all', label: 'All severities' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

export const timeRangeOptions = [
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'custom', label: 'Custom range' },
  { value: 'all', label: 'All available time' },
];

export const rangeLabels: Record<TimeRange, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  custom: 'Custom range',
  all: 'All available time',
};
