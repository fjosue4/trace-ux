import { useEffect, useMemo, useState } from 'react';
import { api, PerformanceEndpoint, PerformanceReport, Site } from '../api';
import { fmtClock, fmtTime } from '../lib/format';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import Switch from '../components/ui/Switch';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import { Icon } from '../components/ui/Icon';
import { Select } from '../components/ui/fields';
import './Performance.css';

type SiteSelection = number | 'all';
type TimeRange = '1h' | '6h' | '24h' | '7d' | 'all';

const timeRangeOptions = [
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All available time' },
];

const rangeLabels: Record<TimeRange, string> = {
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  all: 'All available time',
};

function endpointKey(endpoint: PerformanceEndpoint): string {
  return [endpoint.site_id, endpoint.endpoint, endpoint.environment, endpoint.service, endpoint.version].join('|');
}

function fmtLatency(ms: number): string {
  if (!ms) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  return `${ms.toFixed(ms >= 100 ? 0 : 1)}ms`;
}

function fmtNumber(value: number): string {
  return value.toLocaleString();
}

function timeBounds(range: TimeRange): { from?: number; to: number } {
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

function chartTime(unix: number, range: TimeRange): string {
  if (range === '1h' || range === '6h') return fmtClock(unix);
  return fmtTime(unix).replace(/,? \d{1,2}:\d{2}.*$/, '');
}

function LatencyChart({ endpoint, range }: { endpoint: PerformanceEndpoint; range: TimeRange }) {
  const points = endpoint.series;
  if (points.length === 0) {
    return <div className="performance-chart__empty">No time-series points in this range.</div>;
  }

  const width = 820;
  const height = 260;
  const pad = { top: 18, right: 24, bottom: 36, left: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((point) => point.p99_ms)) * 1.12;
  const x = (index: number) => pad.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const line = (field: 'p50_ms' | 'p95_ms' | 'p99_ms') =>
    points.map((point, index) => `${x(index)},${y(point[field])}`).join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const xLabels = points.length <= 4
    ? points.map((point, index) => ({ index, label: chartTime(point.bucket_start, range) }))
    : [0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) => ({
        index,
        label: chartTime(points[index].bucket_start, range),
      }));

  return (
    <div className="performance-chart">
      <div className="performance-chart__legend" aria-hidden>
        <span><i className="performance-line performance-line--p50" />p50</span>
        <span><i className="performance-line performance-line--p95" />p95</span>
        <span><i className="performance-line performance-line--p99" />p99</span>
      </div>
      <svg className="performance-chart__svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Latency over time for ${endpoint.endpoint}`}>
        {grid.map((fraction) => {
          const value = max * fraction;
          const lineY = y(value);
          return (
            <g key={fraction}>
              <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} className="performance-chart__grid" />
              <text x={pad.left - 10} y={lineY + 4} textAnchor="end" className="performance-chart__label">
                {fmtLatency(value)}
              </text>
            </g>
          );
        })}
        <polyline points={line('p50_ms')} className="performance-chart__path performance-chart__path--p50" />
        <polyline points={line('p95_ms')} className="performance-chart__path performance-chart__path--p95" />
        <polyline points={line('p99_ms')} className="performance-chart__path performance-chart__path--p99" />
        {xLabels.map(({ index, label }) => (
          <text key={`${index}-${label}`} x={x(index)} y={height - 10} textAnchor="middle" className="performance-chart__label">
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function MetricCard({ label, value, detail, tone = '' }: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <Card className={`performance-metric${tone ? ` performance-metric--${tone}` : ''}`}>
      <span className="performance-metric__label">{label}</span>
      <strong className="performance-metric__value">{value}</strong>
      {detail && <span className="muted small">{detail}</span>}
    </Card>
  );
}

export default function Performance() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [siteSel, setSiteSel] = useState<SiteSelection>('all');
  const [environment, setEnvironment] = useState('all');
  const [service, setService] = useState('all');
  const [version, setVersion] = useState('all');
  const [range, setRange] = useState<TimeRange>('24h');
  const [selectedKey, setSelectedKey] = useState('');
  const [live, setLive] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listSites().then(setSites).catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let fetching = false;

    async function load() {
      if (fetching) return;
      fetching = true;
      const bounds = timeBounds(range);
      try {
        const next = await api.performance({
          siteId: siteSel === 'all' ? null : siteSel,
          environment: environment === 'all' ? undefined : environment,
          service: service === 'all' ? undefined : service,
          version: version === 'all' ? undefined : version,
          from: bounds.from,
          to: bounds.to,
          limit: 200,
        });
        if (!cancelled) {
          setReport(next);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load performance data.');
      } finally {
        fetching = false;
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    load();
    const timer = live ? window.setInterval(load, 30_000) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [siteSel, environment, service, version, range, live, refreshNonce]);

  useEffect(() => {
    if (!report || report.endpoints.length === 0) {
      setSelectedKey('');
      return;
    }
    setSelectedKey((current) => report.endpoints.some((endpoint) => endpointKey(endpoint) === current)
      ? current
      : endpointKey(report.endpoints[0]));
  }, [report]);

  const selected = useMemo(
    () => report?.endpoints.find((endpoint) => endpointKey(endpoint) === selectedKey) ?? report?.endpoints[0],
    [report, selectedKey],
  );

  const filterOptions = report?.filters ?? { environments: [], services: [], versions: [] };
  const siteOptions = [
    { value: 'all', label: 'All sites' },
    ...(sites ?? []).map((site) => ({ value: String(site.id), label: site.name })),
  ];

  return (
    <main className="page">
      <PageHeader
        title="Performance"
        subtitle="Backend endpoint latency by environment, service, and version."
        actions={
          <div className="performance-live-control">
            <Badge tone={live ? 'accent' : 'neutral'}>{live ? 'Live' : 'Paused'}</Badge>
            <Switch checked={live} onChange={setLive} label="Auto-refresh" />
          </div>
        }
      />

      <Card className="performance-controls">
        <div className="performance-controls__head">
          <div>
            <strong>Filter performance</strong>
            <p className="muted small">Compare the same endpoint across deployments and releases.</p>
          </div>
          <div className="performance-controls__actions">
            <Select
              className="performance-range"
              ariaLabel="Time range"
              value={range}
              onChange={(value) => setRange(value as TimeRange)}
              options={timeRangeOptions}
            />
            <Button variant="ghost" size="sm" onClick={() => setRefreshNonce((value) => value + 1)}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="performance-filters">
          <Select ariaLabel="Site" value={String(siteSel)} onChange={(value) => setSiteSel(value === 'all' ? 'all' : Number(value))} options={siteOptions} />
          <Select
            ariaLabel="Environment"
            value={environment}
            onChange={setEnvironment}
            options={[{ value: 'all', label: 'All environments' }, ...filterOptions.environments.map((value) => ({ value, label: value }))]}
          />
          <Select
            ariaLabel="Service"
            value={service}
            onChange={setService}
            options={[{ value: 'all', label: 'All services' }, ...filterOptions.services.map((value) => ({ value, label: value }))]}
          />
          <Select
            ariaLabel="Version"
            value={version}
            onChange={setVersion}
            options={[{ value: 'all', label: 'All versions' }, ...filterOptions.versions.map((value) => ({ value, label: value }))]}
          />
        </div>
        <div className="performance-controls__foot">
          <span className="muted small">{rangeLabels[range]} · {report ? `${report.endpoints.length} endpoint${report.endpoints.length === 1 ? '' : 's'}` : 'Loading'}</span>
          <span className="performance-controls__hint"><Icon name="activity" size={13} /> p95 and p99 expose slow-tail regressions</span>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      {loading && !report ? (
        <Loading />
      ) : !report || report.endpoints.length === 0 ? (
        <Card className="performance-empty-card card--static">
          <EmptyState
            icon={<Icon name="activity" size={20} />}
            title="No performance data yet"
            description="Open a site, use Site → Backend performance for the connection example, and send observations from your application server. Once traffic arrives, this page will show latency percentiles and release comparisons."
          />
        </Card>
      ) : (
        <>
          <div className="performance-metrics">
            <MetricCard label="Requests" value={fmtNumber(report.summary.requests)} detail={`${fmtNumber(report.summary.errors)} errors`} />
            <MetricCard label="p50" value={fmtLatency(report.summary.p50_ms)} detail="Typical request" />
            <MetricCard label="p95" value={fmtLatency(report.summary.p95_ms)} detail="Slow-tail latency" tone="warm" />
            <MetricCard label="p99" value={fmtLatency(report.summary.p99_ms)} detail="Worst-tail latency" tone="hot" />
            <MetricCard label="Error rate" value={`${report.summary.error_rate.toFixed(1)}%`} detail={`Average ${fmtLatency(report.summary.avg_ms)}`} tone={report.summary.error_rate > 0 ? 'hot' : ''} />
          </div>

          {selected && (
            <Card className="performance-chart-card">
              <div className="performance-section-head">
                <div>
                  <span className="performance-eyebrow">Selected endpoint</span>
                  <h2>{selected.endpoint}</h2>
                  <p className="muted small">{selected.service} · {selected.environment} · {selected.version}</p>
                </div>
                <div className="performance-chart-summary">
                  <span><strong>{fmtLatency(selected.p95_ms)}</strong><small>p95</small></span>
                  <span><strong>{fmtLatency(selected.p99_ms)}</strong><small>p99</small></span>
                </div>
              </div>
              <LatencyChart endpoint={selected} range={range} />
            </Card>
          )}

          <div className="performance-table-head">
            <div>
              <h2>Endpoints</h2>
              <p className="muted small">Sorted by p95 latency. Select a row to inspect its trend.</p>
            </div>
          </div>
          <Table
            className="performance-table"
            fixed
            widths={['27%', '12%', '13%', '13%', '11%', '7%', '7%', '7%', '8%']}
            headers={['Endpoint', 'Site', 'Environment', 'Service', 'Version', 'Requests', 'p50', 'p95', 'p99']}
          >
            {report.endpoints.map((endpoint) => {
              const key = endpointKey(endpoint);
              return (
                <tr key={key} className={key === selectedKey ? 'is-selected' : ''} onClick={() => setSelectedKey(key)}>
                  <td><button type="button" className="performance-endpoint" title={endpoint.endpoint}>{endpoint.endpoint}</button></td>
                  <td className="muted">{endpoint.site_name || '—'}</td>
                  <td><span className="performance-dimension">{endpoint.environment}</span></td>
                  <td><span className="performance-dimension">{endpoint.service}</span></td>
                  <td><span className="performance-dimension mono">{endpoint.version}</span></td>
                  <td className="mono">{fmtNumber(endpoint.requests)}</td>
                  <td className="mono">{fmtLatency(endpoint.p50_ms)}</td>
                  <td className="mono performance-latency--p95">{fmtLatency(endpoint.p95_ms)}</td>
                  <td className="mono performance-latency--p99">{fmtLatency(endpoint.p99_ms)}</td>
                </tr>
              );
            })}
          </Table>
        </>
      )}
    </main>
  );
}
