// Formatting helpers shared across pages.

export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtTime(unix: number): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtClock(unix: number): string {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function stripProto(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function formatCountry(value: string): string {
  const code = (value || '').trim().toUpperCase();
  if (!code) return 'Unknown';

  // DisplayNames is optional in older browsers, so keep the ISO code as a
  // safe fallback without requiring a large country-name bundle.
  const intlWithDisplayNames = Intl as typeof Intl & {
    DisplayNames?: new (
      locales?: string | string[],
      options?: { type: 'region' },
    ) => { of: (region: string) => string | undefined };
  };
  try {
    const DisplayNames = intlWithDisplayNames.DisplayNames;
    const name = DisplayNames && new DisplayNames('en', { type: 'region' }).of(code);
    return name || code;
  } catch {
    return code;
  }
}

export function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const precision = v >= 100 || u === 0 ? 0 : 1;
  return `${v.toFixed(precision)} ${units[u]}`;
}
