import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Table from '../../components/ui/Table';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import FilterPanel from '../../components/ui/FilterPanel';
import Switch from '../../components/ui/Switch';
import { Icon } from '../../components/ui/Icon';
import { Input, Select } from '../../components/ui/fields';
import { fmtClock } from '../../lib/format';
import { useLogs } from './hooks/useLogs';
import { LogsSummary } from './subcomponents/LogsSummary';
import { LogRow } from './subcomponents/LogRow';
import { LogDetailModal } from './subcomponents/LogDetailModal';
import { useLinkedLog } from './hooks/useLinkedLog';
import { LogSearchField } from './subcomponents/LogSearchField';
import { MAX_VISIBLE_LOGS, severityOptions, timeRangeOptions } from './Logs.constants';
import { SeveritySelection } from './Logs.types';
import './Logs.scss';

export default function Logs() {
  const [linkCopied, setLinkCopied] = useState(false);
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
    serviceSel,
    setServiceSel,
    environment,
    setEnvironment,
    filterOptions,
    search,
    setSearch,
    searchIn,
    setSearchIn,
    timeRange,
    changeTimeRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    timeWindow,
    summary,
  } = useLogs();

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1600);
  }
  // The open log lives at /logs/log/<id>, so the address bar is always a
  // shareable link to it. Held as the row object, so live refreshes that drop
  // the row from the visible window do not close the modal mid-read.
  const { openLog, open: openLogDetail, close: closeLogDetail, linkError } = useLinkedLog(logs);

  return (
    <main className="page">
      <PageHeader
        title="Logs"
        subtitle="Monitor browser and service logs in one searchable stream."
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

      <FilterPanel
        title="Filter logs"
        className="logs-controls filter-panel--grid"
        controlsClassName="logs-query-row"
        afterControls={timeRange === 'custom' ? (
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
          ) : undefined}
        footer={(
          <>
            <span className="muted small">
              {logs ? `${logs.length.toLocaleString()} shown` : 'Loading'} · up to {MAX_VISIBLE_LOGS.toLocaleString()} rows
              {lastUpdated > 0 && ` · updated ${fmtClock(Math.floor(lastUpdated / 1000))}`}
            </span>
            {summary.length > 0 && <LogsSummary summary={summary} />}
            <Button variant="ghost" size="sm" onClick={copyLink}>
              <Icon name={linkCopied ? 'check' : 'copy'} size={13} />
              {linkCopied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRefreshNonce((value) => value + 1)}>
              Refresh
            </Button>
          </>
        )}
      >
        <LogSearchField
          value={search}
          onChange={setSearch}
          scope={searchIn}
          onScopeChange={setSearchIn}
        />
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
          ariaLabel="Service"
          value={String(serviceSel)}
          onChange={(value) => setServiceSel(value === 'all' ? 'all' : Number(value))}
          options={[
            { value: 'all', label: 'All services' },
            ...filterOptions.services.map((service) => ({ value: String(service.id), label: service.name })),
          ]}
        />
        <Select
          className="logs-filter"
          ariaLabel="Environment"
          value={environment}
          onChange={setEnvironment}
          options={[
            { value: 'all', label: 'All environments' },
            ...filterOptions.environments.map((value) => ({ value, label: value })),
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
      </FilterPanel>

      {error && <Notice tone="error">{error}</Notice>}
      {linkError && <Notice tone="warn">{linkError}</Notice>}
      {!timeWindow.valid && <Notice tone="info">{timeWindow.error}</Notice>}

      {sites !== null && sites.length === 0 ? (
        <EmptyState
          title="No sites yet"
          description="Create a site first — its logs will show up here."
          icon={<Icon name="code" size={20} />}
          action={
            <Link to="/sites" className="btn btn--primary btn--md">
              Go to sites
            </Link>
          }
        />
      ) : !timeWindow.valid ? null : loading || logs === null ? (
        <Loading />
      ) : logs.length === 0 ? (
        <EmptyState
          title={search ? 'No logs found' : live && timeRange === '15m' ? 'Waiting for logs' : 'No logs match'}
          description={
            search
              ? `No logs match “${search}”. Try another term or broaden the filters.`
              : live && timeRange === '15m'
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
            widths={['12%', '8%', '24%', '18%', '12%', '10%', '8%', '8%']}
            headers={['Time', 'Level', 'Message', 'Extra', 'Service', 'Environment', 'Site', 'Source']}
          >
            {logs.map((log) => (
              <LogRow key={log.id} log={log} onOpen={openLogDetail} />
            ))}
          </Table>
        </>
      )}

      <LogDetailModal log={openLog} onClose={closeLogDetail} />
    </main>
  );
}
