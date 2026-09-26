import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import Badge from '../../components/ui/Badge';
import Switch from '../../components/ui/Switch';
import Button from '../../components/ui/Button';
import Table from '../../components/ui/Table';
import FilterPanel from '../../components/ui/FilterPanel';
import { Icon } from '../../components/ui/Icon';
import { Select } from '../../components/ui/fields';
import { usePerformance } from './hooks/usePerformance';
import { LatencyChart } from './subcomponents/LatencyChart';
import { MetricCard } from './subcomponents/MetricCard';
import { EndpointRow } from './subcomponents/EndpointRow';
import { endpointKey, fmtLatency, fmtNumber } from './Performance.helpers';
import { timeRangeOptions, rangeLabels } from './Performance.constants';
import { TimeRange } from './Performance.types';
import './Performance.scss';

export default function Performance() {
  const {
    report,
    siteSel,
    setSiteSel,
    environment,
    setEnvironment,
    service,
    setService,
    version,
    setVersion,
    range,
    setRange,
    selectedKey,
    setSelectedKey,
    live,
    setLive,
    setRefreshNonce,
    loading,
    error,
    selected,
    filterOptions,
    siteOptions,
  } = usePerformance();

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

      <FilterPanel
        title="Filter performance"
        actions={(
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
        )}
        footer={(
          <>
            <span className="muted small">{rangeLabels[range]} · {report ? `${report.endpoints.length} endpoint${report.endpoints.length === 1 ? '' : 's'}` : 'Loading'}</span>
            <span className="performance-controls__hint"><Icon name="activity" size={13} /> p95 and p99 expose slow-tail regressions</span>
          </>
        )}
      >
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
      </FilterPanel>

      {error && <Notice tone="error">{error}</Notice>}

      {loading && !report ? (
        <Loading />
      ) : !report || report.endpoints.length === 0 ? (
        <Card className="performance-empty-card card--static">
          <EmptyState
            icon={<Icon name="activity" size={20} />}
            title="No performance data yet"
            description="Open a site, add a service, and use its shared key to send performance observations from your application server. Once traffic arrives, this page will show latency percentiles and release comparisons."
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
                <div className="performance-section-head__title">
                  <span className="performance-eyebrow">Selected endpoint</span>
                  <h2 title={selected.endpoint}>{selected.endpoint}</h2>
                  <p className="muted small" title={`${selected.service} · ${selected.environment} · ${selected.version}`}>
                    {selected.service} · {selected.environment} · {selected.version}
                  </p>
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
            {report.endpoints.map((endpoint) => (
              <EndpointRow key={endpointKey(endpoint)} endpoint={endpoint} isSelected={endpointKey(endpoint) === selectedKey} onSelect={setSelectedKey} />
            ))}
          </Table>
        </>
      )}
    </main>
  );
}
