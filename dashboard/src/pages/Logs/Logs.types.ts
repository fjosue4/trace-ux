import { LogSeverity } from '../../api';

export type SiteSelection = number | 'all';
export type SeveritySelection = LogSeverity | 'all';
export type TimeRange = '15m' | '1h' | '6h' | '24h' | '7d' | 'custom' | 'all';

export type TimeWindow = {
  fromMs?: number;
  toMs?: number;
  valid: boolean;
  error?: string;
};
