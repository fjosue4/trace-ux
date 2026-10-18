import { PerformanceEndpoint } from '../../api';
import { fmtClock, fmtTime } from '../../lib/format';
import { TimeRange } from './Performance.types';

export function endpointKey(endpoint: PerformanceEndpoint): string {
  return [endpoint.site_id, endpoint.endpoint, endpoint.environment, endpoint.service, endpoint.version].join('|');
}

const versionCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Versions may use four numeric parts or opaque release names as well as
// semver. Compare numeric releases naturally and put stable after prerelease.
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => /^v?(\d+(?:\.\d+)*)(?:-([\w.-]+))?(?:\+.*)?$/.exec(value);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return versionCollator.compare(a, b);
  const leftParts = left[1].split('.');
  const rightParts = right[1].split('.');
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i++) {
    const compared = versionCollator.compare(leftParts[i] ?? '0', rightParts[i] ?? '0');
    if (compared) return compared;
  }
  if (!left[2] || !right[2]) return left[2] ? -1 : right[2] ? 1 : 0;
  const leftPre = left[2].split('.');
  const rightPre = right[2].split('.');
  for (let i = 0; i < Math.max(leftPre.length, rightPre.length); i++) {
    if (leftPre[i] === undefined) return -1;
    if (rightPre[i] === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftPre[i]);
    const rightNumeric = /^\d+$/.test(rightPre[i]);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    const compared = versionCollator.compare(leftPre[i], rightPre[i]);
    if (compared) return compared;
  }
  return 0;
}

export function latestEndpointVersions(endpoints: PerformanceEndpoint[]): PerformanceEndpoint[] {
  const groupKey = (endpoint: PerformanceEndpoint) => JSON.stringify([endpoint.site_id, endpoint.environment, endpoint.service]);
  const latest = new Map<string, string>();
  for (const endpoint of endpoints) {
    const key = groupKey(endpoint);
    const current = latest.get(key);
    if (current === undefined || compareVersions(endpoint.version, current) > 0) latest.set(key, endpoint.version);
  }
  return endpoints.filter((endpoint) => endpoint.version === latest.get(groupKey(endpoint)));
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
  if (range === '1h' || range === '6h' || range === '24h') return fmtClock(unix);
  return fmtTime(unix).replace(/,? \d{1,2}:\d{2}.*$/, '');
}
