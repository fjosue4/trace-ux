import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Table from '../../components/ui/Table';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Switch from '../../components/ui/Switch';
import { Icon } from '../../components/ui/Icon';
import { Input, Select } from '../../components/ui/fields';
import { fmtClock } from '../../lib/format';
import { useLogs } from './hooks/useLogs';
import { LogsSummary } from './subcomponents/LogsSummary';
import { LogRow } from './subcomponents/LogRow';
import { MAX_VISIBLE_LOGS, rangeLabels, severityOptions, timeRangeOptions } from './Logs.constants';
import { SeveritySelection } from './Logs.types';
import './Logs.scss';

export default function Logs() {
  const {
    sites,
    logs,
    error,
    lastUpdated,
    loading,
    setRefreshNonce,
    live,
    setLive,
    siteSel,
    setSiteSel,
    severitySel,
    setSeveritySel,
    timeRange,
    changeTimeRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    timeWindow,
    summary,
  } = useLogs();

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
        {summary.length > 0 && <LogsSummary summary={summary} timeRange={timeRange} />}

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
              multiple
              value={severitySel}
              onChange={(value) => setSeveritySel(value as SeveritySelection)}
              emptyLabel="All severities"
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
              : 'Try a wider time range, another severity combination, or enable Logs in a site configuration.'
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
              <LogRow key={log.id} log={log} />
            ))}
          </Table>
        </>
      )}
    </main>
  );
}
