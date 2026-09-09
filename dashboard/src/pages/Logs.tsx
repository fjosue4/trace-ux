import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, Log, LogSeverity, LogStats, Site } from '../api';
import { fmtClock, fmtTime, stripProto, truncate } from '../lib/format';
import PageHeader from '../components/ui/PageHeader';
import Table from '../components/ui/Table';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Switch from '../components/ui/Switch';
import { Icon } from '../components/ui/Icon';
import { Input, Select } from '../components/ui/fields';
import './Logs.css';

const MAX_VISIBLE_LOGS = 1000;
const LIVE_REFRESH_MS = 5000;

type SiteSelection = number | 'all';
type SeveritySelection = LogSeverity | 'all';
type TimeRange = '15m' | '1h' | '6h' | '24h' | '7d' | 'custom' | 'all';

type TimeWindow = {
  fromMs?: number;
  toMs?: number;
  valid: boolean;
  error?: string;
};

const severityOptions = [
  { value: 'all', label: 'All severities' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

const timeRangeOptions = [
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'custom', label: 'Custom range' },
  { value: 'all', label: 'All available time' },
];

const rangeLabels: Record<TimeRange, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  custom: 'Custom range',
  all: 'All available time',
};

function severityTone(severity: LogSeverity): 'accent' | 'neutral' | 'danger' {
  return severity === 'error' ? 'danger' : severity === 'warn' ? 'accent' : 'neutral';
}

function logTimestamp(log: Log): number {
  return Math.floor(log.timestamp_ms / 1000) || log.created_at;
}

function parseDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveTimeWindow(range: TimeRange, customFrom: string, customTo: string): TimeWindow {
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

export default function Logs() {
  const [params] = useSearchParams();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [live, setLive] = useState(true);
  const [siteSel, setSiteSel] = useState<SiteSelection>(
    params.get('site') ? Number(params.get('site')) : 'all',
  );
  const [severitySel, setSeveritySel] = useState<SeveritySelection>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('15m');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    const initialWindow = resolveTimeWindow(timeRange, customFrom, customTo);
    if (!initialWindow.valid) {
      setLogs([]);
      setStats(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let fetching = false;

    async function load() {
      if (fetching) return;
      fetching = true;
      const window = resolveTimeWindow(timeRange, customFrom, customTo);
      const siteId = siteSel === 'all' ? null : siteSel;
      const severity = severitySel === 'all' ? '' : severitySel;
      try {
        const [rows, summary] = await Promise.all([
          api.listLogs({
            siteId,
            severity,
            fromMs: window.fromMs,
            toMs: window.toMs,
            limit: MAX_VISIBLE_LOGS,
          }),
          api.logStats({ siteId, fromMs: window.fromMs, toMs: window.toMs }),
        ]);
        if (!cancelled) {
          setLogs(rows);
          setStats(summary);
          setError('');
          setLastUpdated(Date.now());
        }
      } catch {
        if (!cancelled) setError('Could not load logs.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          fetching = false;
        }
      }
    }

    setLoading(true);
    load();
    const timer = live ? window.setInterval(load, LIVE_REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [siteSel, severitySel, timeRange, customFrom, customTo, live, refreshNonce]);

  const timeWindow = resolveTimeWindow(timeRange, customFrom, customTo);
  const summary = stats
    ? [
        { label: 'All logs', value: stats.total, severity: '' as const },
        { label: 'Errors', value: stats.error, severity: 'error' as const },
        { label: 'Warnings', value: stats.warn, severity: 'warn' as const },
        { label: 'Info', value: stats.info, severity: 'info' as const },
        { label: 'Debug', value: stats.debug, severity: 'debug' as const },
      ]
    : [];

  function changeTimeRange(value: string) {
    const next = value as TimeRange;
    setTimeRange(next);
    if (next === 'all') setLive(false);
  }

  return (
    <main className="page">
      <PageHeader
        title="Logs"
        subtitle="Monitor browser output captured alongside visitor recordings."
        actions={
          <div className="logs-live-control">
            <span className={`logs-live-state${live ? ' is-live' : ''}`}>
              <span className="logs-live-dot" />
              {live ? 'Live' : 'Paused'}
            </span>
            <Switch checked={live} onChange={setLive} label="Auto-refresh" />
          </div>
        }
      />

      <div className={`logs-overview${summary.length > 0 ? '' : ' logs-overview--solo'}`}>
        {summary.length > 0 && (
          <Card className="logs-summary">
            <div className="logs-summary__head">
              <strong>Log volume</strong>
              <span className="muted small">{rangeLabels[timeRange]}</span>
            </div>
            <div className="logs-summary__items">
              {summary.map((item) => (
                <div key={item.label} className="logs-summary__item">
                  <span className="logs-summary__label">{item.label}</span>
                  <strong className={`logs-summary__num${item.severity ? ` logs-summary__num--${item.severity}` : ''}`}>
                    {item.value.toLocaleString()}
                  </strong>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="logs-controls">
          <div className="logs-controls__head">
            <div>
              <strong>Filter logs</strong>
              <p className="muted small">Use a rolling window for monitoring or choose an exact time range.</p>
            </div>
            <span className="logs-window-label">
              <Icon name="clock" size={13} />
              {rangeLabels[timeRange]}
            </span>
          </div>
          <div className="logs-filters">
            <Select
              className="logs-filter logs-filter--site"
              ariaLabel="Site"
              value={String(siteSel)}
              onChange={(value) => setSiteSel(value === 'all' ? 'all' : Number(value))}
              options={[
                { value: 'all', label: 'All sites' },
                ...(sites ?? []).map((site) => ({ value: String(site.id), label: site.name })),
              ]}
            />
            <Select
              className="logs-filter"
              ariaLabel="Severity"
              value={severitySel}
              onChange={(value) => setSeveritySel(value as SeveritySelection)}
              options={severityOptions}
            />
            <Select
              className="logs-filter logs-filter--time"
              ariaLabel="Time range"
              value={timeRange}
              onChange={changeTimeRange}
              options={timeRangeOptions}
            />
          </div>
          {timeRange === 'custom' && (
            <div className="logs-custom-range">
              <label>
                <span>From</span>
                <Input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label>
                <span>To</span>
                <Input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </div>
          )}
          <div className="logs-controls__foot">
            <span className="muted small">
              {logs ? `${logs.length.toLocaleString()} shown` : 'Loading'} · up to {MAX_VISIBLE_LOGS.toLocaleString()} rows
              {lastUpdated > 0 && ` · updated ${fmtClock(Math.floor(lastUpdated / 1000))}`}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setRefreshNonce((value) => value + 1)}>
              Refresh
            </Button>
          </div>
        </Card>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!timeWindow.valid && <Notice tone="info">{timeWindow.error}</Notice>}

      {sites !== null && sites.length === 0 ? (
        <EmptyState
          title="No sites yet"
          description="Create a site first — its logs will show up here."
          icon={<Icon name="code" size={20} />}
          action={
            <Link to="/" className="btn btn--primary btn--md">
              Go to sites
            </Link>
          }
        />
      ) : !timeWindow.valid ? null : loading || logs === null ? (
        <Loading />
      ) : logs.length === 0 ? (
        <EmptyState
          title={live && timeRange === '15m' ? 'Waiting for logs' : 'No logs match'}
          description={
            live && timeRange === '15m'
              ? 'New logs from the last 15 minutes will appear here automatically.'
              : 'Try a wider time range, another severity, or enable Logs in a site configuration.'
          }
          icon={<Icon name="code" size={20} />}
        />
      ) : (
        <>
          {logs.length >= MAX_VISIBLE_LOGS && (
            <Notice tone="info">
              Showing the newest {MAX_VISIBLE_LOGS.toLocaleString()} logs. Narrow the time range to see older entries.
            </Notice>
          )}
          <Table
            className="logs-table"
            fixed
            widths={['14%', '9%', '34%', '13%', '17%', '13%']}
            headers={['Time', 'Severity', 'Message', 'Site', 'Page', 'Recording']}
          >
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="muted small">{fmtTime(logTimestamp(log))}</td>
                <td>
                  <Badge tone={severityTone(log.severity)}>{log.severity}</Badge>
                </td>
                <td className="logs-message" title={log.message}>
                  {truncate(log.message || '—', 100)}
                </td>
                <td className="muted">{log.site_name ?? '—'}</td>
                <td className="muted small" title={log.url}>
                  {log.url ? truncate(stripProto(log.url), 32) : '—'}
                </td>
                <td>
                  <Link to={`/replay/${log.session_id}`} className="logs-replay" title="Open recording">
                    <Icon name="play" size={11} />
                    Replay
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </main>
  );
}
