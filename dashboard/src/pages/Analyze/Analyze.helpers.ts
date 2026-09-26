import { AnalyzeDefinition, AnalyzeInterval, AnalyzeRange, AnalyzeReport, AnalyzeResult } from '../../api';
import { LIMITS } from './Analyze.constants';
import { AnalyzeWindow, EditorErrors, EditorForm, WindowKey } from './Analyze.types';

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

// ---- Timezones and calendar days ----

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

let zoneCache: string[] | null = null;
export function timezoneOptions(): string[] {
  if (zoneCache) return zoneCache;
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  let zones: string[] = [];
  try {
    zones = supported ? supported('timeZone') : [];
  } catch {
    zones = [];
  }
  zoneCache = zones.includes('UTC') ? zones : ['UTC', ...zones];
  return zoneCache;
}

export function isKnownTimezone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a zone. */
export function dateInZone(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(ms);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Calendar arithmetic on YYYY-MM-DD strings, independent of any zone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function formatDay(ms: number, zone: string, style: 'short' | 'long' = 'short'): string {
  const options: Intl.DateTimeFormatOptions = style === 'long'
    ? { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
    : { timeZone: zone, month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat(undefined, options).format(ms);
}

function formatClock(ms: number, zone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(ms);
}

const BUCKET_MS: Record<AnalyzeInterval, number> = { '5min': 5 * 60_000, hour: 3_600_000, day: 86_400_000 };
const MIDNIGHT = formatClock(Date.UTC(2000, 0, 1), 'UTC');

/** A bucket's label. Short labels are axis ticks: a date for days, a clock
 *  time for hours and minutes -- except at local midnight, where the date
 *  says which day the following ticks belong to. Long labels name the
 *  bucket's full span, for tooltips and tables. */
export function formatBucket(ms: number, zone: string, interval: AnalyzeInterval, style: 'short' | 'long' = 'short'): string {
  if (interval === 'day') return formatDay(ms, zone, style);
  if (style === 'short') return formatClock(ms, zone) === MIDNIGHT ? formatDay(ms, zone) : formatClock(ms, zone);
  const day = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);
  return `${day}, ${formatClock(ms, zone)}–${formatClock(ms + BUCKET_MS[interval], zone)}`;
}

/** The span a result covers, e.g. "Sep 12 – Sep 25" or "Sep 25, 13:00 – 14:05". */
export function formatSpan(from: number, to: number, zone: string, interval: AnalyzeInterval): string {
  if (interval === 'day') return `${formatDay(from, zone)} – ${formatDay(to - 1, zone)}`;
  const at = (ms: number) => `${formatDay(ms, zone)}, ${formatClock(ms, zone)}`;
  return `${at(from)} – ${dateInZone(from, zone) === dateInZone(to, zone) ? formatClock(to, zone) : at(to)}`;
}

/** "day", "hour" or "5 minutes": the unit an average is per. */
export function intervalUnit(interval: AnalyzeInterval): string {
  return interval === '5min' ? '5 minutes' : interval;
}

/** "30 days", "24 hours", "12 five-minute periods". */
export function bucketCount(n: number, interval: AnalyzeInterval): string {
  if (interval === '5min') return `${n} five-minute ${n === 1 ? 'period' : 'periods'}`;
  return `${n} ${interval}${n === 1 ? '' : 's'}`;
}

export function formatDateTime(ms: number, zone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(ms);
}

export function fmtCount(value: number): string {
  return value.toLocaleString();
}

export function fmtAverage(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 1 });
}

// ---- Windows ----

export function windowKey(window: AnalyzeWindow): WindowKey {
  return window.days !== undefined ? `d${window.days}` : `h${window.hours}`;
}

export function parseWindowKey(key: string | null): AnalyzeWindow | null {
  const match = /^([hd])([1-9]\d{0,2})$/.exec(key ?? '');
  if (!match) return null;
  const n = Number(match[2]);
  if (match[1] === 'h') return n <= LIMITS.maxHours ? { hours: n } : null;
  return n <= LIMITS.maxDays ? { days: n } : null;
}

export function definitionWindow(def: AnalyzeDefinition): AnalyzeWindow {
  return def.default_hours ? { hours: def.default_hours } : { days: def.default_days ?? 30 };
}

/** Mirrors the server's derivation of a window's bucket size. */
export function intervalFor(window: AnalyzeWindow): AnalyzeInterval {
  if (!window.hours) return 'day';
  return window.hours <= LIMITS.fiveMinuteHours ? '5min' : 'hour';
}

export function windowLabel(window: AnalyzeWindow): string {
  if (window.hours) {
    if (window.hours === 1) return 'Last hour';
    if (window.hours % 24 === 0 && window.hours > 24) return `Last ${window.hours / 24} days`;
    return `Last ${window.hours} hours`;
  }
  return window.days === 1 ? 'Last day' : `Last ${window.days} days`;
}

export function rangeForWindow(window: AnalyzeWindow): AnalyzeRange {
  return window.hours ? { hours: window.hours } : { days: window.days };
}

// ---- Definitions ----

export function emptyForm(): EditorForm {
  return {
    name: '',
    description: '',
    visibility: 'team',
    siteId: null,
    source: 'event',
    eventName: '',
    trackId: '',
    message: '',
    // Real messages carry ids, payloads and stack traces, so a stable part of
    // the text is usually what a report should follow.
    messageMode: 'contains',
    severity: '',
    serviceId: null,
    environment: '',
    window: { days: 30 },
    timezone: browserTimezone(),
    visualization: 'bar',
  };
}

export function formFromReport(report: AnalyzeReport): EditorForm {
  const def = report.definition;
  return {
    ...emptyForm(),
    name: report.name,
    description: report.description,
    visibility: report.visibility,
    siteId: def.site_id,
    source: def.source,
    eventName: def.match.name ?? '',
    trackId: def.match.track_id ?? '',
    message: def.match.message ?? '',
    messageMode: def.match.message_mode ?? 'exact',
    severity: def.match.severity ?? '',
    serviceId: def.match.service_id ?? null,
    environment: def.match.environment ?? '',
    window: definitionWindow(def),
    timezone: def.timezone,
    visualization: def.visualization,
  };
}

/** Builds the definition exactly as it will be saved: only the fields the
 *  source supports, and optional filters left out rather than sent blank. */
export function definitionFromForm(form: EditorForm): AnalyzeDefinition {
  const match: AnalyzeDefinition['match'] = {};
  if (form.source === 'event') {
    match.name = form.eventName;
    if (form.trackId) match.track_id = form.trackId;
  } else {
    match.message = form.message;
    match.message_mode = form.messageMode;
    if (form.severity) match.severity = form.severity;
    if (form.serviceId) match.service_id = form.serviceId;
    if (form.environment) match.environment = form.environment;
  }
  return {
    version: 1,
    source: form.source,
    site_id: form.siteId,
    metric: 'occurrences',
    match,
    ...(form.window.hours ? { default_hours: form.window.hours } : { default_days: form.window.days }),
    interval: intervalFor(form.window),
    timezone: form.timezone,
    visualization: form.visualization,
  };
}

/** Immediate feedback only; the server repeats every check. */
export function validateForm(form: EditorForm): EditorErrors {
  const errors: EditorErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Give the report a name.';
  else if ([...name].length > LIMITS.name) errors.name = `Keep the name to ${LIMITS.name} characters.`;
  if ([...form.description.trim()].length > LIMITS.description) {
    errors.description = `Keep the description to ${LIMITS.description} characters.`;
  }
  if (form.source === 'event') {
    if (!form.eventName.trim()) errors.match = 'Choose the action to count.';
    else if (byteLength(form.eventName) > LIMITS.eventField) errors.match = `Action names are at most ${LIMITS.eventField} bytes.`;
    if (form.trackId && !form.trackId.trim()) errors.trackId = 'Leave the track ID empty to match any, or enter one.';
    else if (byteLength(form.trackId) > LIMITS.eventField) errors.trackId = `Track IDs are at most ${LIMITS.eventField} bytes.`;
  } else {
    if (!form.message.trim()) {
      errors.match = form.messageMode === 'contains' ? 'Enter the text to look for in log messages.' : 'Choose the log message to count.';
    } else if (byteLength(form.message) > LIMITS.logMessageBytes) {
      errors.match = form.messageMode === 'contains'
        ? `Keep the text to ${LIMITS.logMessageBytes.toLocaleString()} bytes; the part that stays the same is usually enough.`
        : `Exact messages are limited to ${LIMITS.logMessageBytes.toLocaleString()} bytes. Switch to Contains and use part of it.`;
    }
  }
  if (!isKnownTimezone(form.timezone) || form.timezone === 'Local') errors.timezone = 'Choose a timezone such as America/Tegucigalpa.';
  if (!parseWindowKey(windowKey(form.window))) {
    errors.window = `Windows are 1–${LIMITS.maxHours} hours or 1–${LIMITS.maxDays} days.`;
  }
  return errors;
}

export function hasSourceFields(form: EditorForm): boolean {
  return form.source === 'event'
    ? Boolean(form.eventName || form.trackId)
    : Boolean(form.message || form.severity || form.serviceId || form.environment);
}

export function clearSourceFields(form: EditorForm): EditorForm {
  return { ...form, eventName: '', trackId: '', message: '', messageMode: 'contains', severity: '', serviceId: null, environment: '' };
}

// ---- Presentation ----

export function truncateText(value: string, max: number): string {
  const chars = [...value];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
}

/** One-line description of what a report counts. */
export function matchSummary(def: AnalyzeDefinition, serviceName?: string): string {
  const m = def.match;
  if (def.source === 'event') {
    return [m.name, m.track_id ? `#${m.track_id}` : 'any track ID'].join(' · ');
  }
  return [
    `${m.message_mode === 'contains' ? 'contains ' : ''}“${truncateText(m.message ?? '', 72)}”`,
    m.severity ?? 'any severity',
    m.service_id ? (serviceName || `service ${m.service_id}`) : null,
    m.environment || null,
  ].filter(Boolean).join(' · ');
}

// ---- Drill-down ----

function localInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function trimToBytes(value: string, maxBytes: number): string {
  let out = '';
  for (const char of value) {
    if (byteLength(out + char) > maxBytes) break;
    out += char;
  }
  return out;
}

/** A link to the page that lists what a report counts, with the closest
 *  filters that page offers. Sessions has no date filter, and the Logs search
 *  is a contains-match, so these narrow to the report rather than replicate
 *  it exactly. */
export function drillDownLink(def: AnalyzeDefinition, result: AnalyzeResult | null): { to: string; label: string } {
  const q = new URLSearchParams();
  if (def.site_id) q.set('site', String(def.site_id));
  if (def.source === 'event') {
    q.set('action', def.match.track_id || def.match.name || '');
    return { to: `/sessions?${q}`, label: 'Open matching sessions' };
  }
  if (def.match.service_id) q.set('service', String(def.match.service_id));
  if (def.match.environment) q.set('environment', def.match.environment);
  if (def.match.severity) q.set('severity', def.match.severity);
  // The Logs search is a case-insensitive contains match: identical to a
  // contains report, and a superset of an exact one.
  q.set('search', trimToBytes(def.match.message ?? '', LIMITS.logSearchBytes));
  q.set('search_in', 'message');
  if (result) {
    q.set('range', 'custom');
    q.set('from', localInputValue(result.from));
    q.set('to', localInputValue(result.to - 60_000));
  }
  return { to: `/logs?${q}`, label: 'Open matching logs' };
}
