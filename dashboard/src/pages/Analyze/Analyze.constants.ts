import { AnalyzeScope } from '../../api';
import { AnalyzeWindow } from './Analyze.types';

/** Rolling windows offered as a report's default and as temporary ranges. */
export const WINDOW_OPTIONS: AnalyzeWindow[] = [
  { hours: 1 },
  { hours: 12 },
  { hours: 24 },
  { hours: 72 },
  { days: 7 },
  { days: 14 },
  { days: 30 },
  { days: 90 },
];

export const SCOPES: { value: AnalyzeScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'team', label: 'Team' },
];

export const SOURCE_LABELS = { event: 'Action', log: 'Log' } as const;

// Mirrors the server's bounds so the builder can say no before a round trip.
// The server remains the authority on every one of them.
export const LIMITS = {
  name: 120,
  description: 1000,
  eventField: 100,
  logMessageBytes: 4096,
  environment: 128,
  maxDays: 365,
  maxHours: 168,
  // Mirrors the server: windows up to this many hours use 5-minute buckets.
  fiveMinuteHours: 6,
  // /api/logs rejects longer searches, so drill-down links trim to this.
  logSearchBytes: 256,
};

// How many library cards fetch their results at once. SQLite serializes the
// queries anyway; this just keeps the first cards from waiting on the last.
export const SUMMARY_CONCURRENCY = 3;
