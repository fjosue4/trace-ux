import { AnalyzeMessageMode, AnalyzeSource, AnalyzeVisibility, AnalyzeVisualization, LogSeverity } from '../../api';

export type SiteSelection = number | 'all';

/** A rolling window: exactly one of hours or days. */
export type AnalyzeWindow = { hours: number; days?: undefined } | { days: number; hours?: undefined };

/** Serialised window for selects and the URL: h24, d30, ... */
export type WindowKey = `h${number}` | `d${number}`;

/** The report view's temporary range. 'default' uses the report's saved window. */
export type RangeChoice = 'default' | 'custom' | WindowKey;

/** Flat builder state. Both sources' fields live side by side so switching
 *  source can be confirmed before anything is cleared. */
export type EditorForm = {
  name: string;
  description: string;
  visibility: AnalyzeVisibility;
  siteId: number | null;
  source: AnalyzeSource;
  eventName: string;
  trackId: string;
  message: string;
  messageMode: AnalyzeMessageMode;
  severity: LogSeverity | '';
  serviceId: number | null;
  environment: string;
  window: AnalyzeWindow;
  timezone: string;
  visualization: AnalyzeVisualization;
};

export type EditorErrors = Partial<Record<'name' | 'description' | 'match' | 'trackId' | 'environment' | 'timezone' | 'window', string>>;
