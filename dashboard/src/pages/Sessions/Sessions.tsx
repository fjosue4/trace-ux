import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Table from '../../components/ui/Table';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import StatStrip from '../../components/ui/StatStrip';
import FiltersBar from '../../components/sessions/FiltersBar';
import { Select } from '../../components/ui/fields';
import { dayKey, dayLabel } from '../../lib/format';
import { markCachedSessionViewed, useSessions } from './hooks/useSessions';
import { SessionRow } from './subcomponents/SessionRow';
import { SESSION_PAGE_SIZE } from './Sessions.constants';
import { replayPath } from './Sessions.helpers';
import './Sessions.scss';

// Global sessions browser: every session across every site, filterable per
// site or in aggregate. /sessions?site=N deep-links preselect the site.
export default function Sessions() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sites, sessions, countries, error, selected, setSelected, filter, set, stats, searching, hasMore, loadingMore, loadMore, loadMoreError } = useSessions();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState(false);
  const showSite = selected === 'all';
  // The replay's back link returns here with the same filters applied.
  const from = `${location.pathname}${location.search}`;
  const siteName = selected === 'all' ? null : sites?.find((s) => s.id === selected)?.name;

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMore || loadingMore || loadMoreError || searching || typing) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMore();
      },
      { rootMargin: '500px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMoreError, loadMore, searching, typing]);

  // Rows are grouped under a header per calendar day, newest first.
  const groups: { key: string; startedAt: number; count: number }[] = [];
  for (const s of sessions ?? []) {
    const key = dayKey(s.started_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.count++;
    else groups.push({ key, startedAt: s.started_at, count: 1 });
  }

  const total = stats ? stats.active + stats.completed : null;

  return (
    <main className="page">
      <PageHeader
        title="Sessions"
        subtitle={siteName ? `Recorded visits on ${siteName}, newest first.` : 'Every recorded visit across your sites, newest first.'}
      />

      <StatStrip
        items={[
          {
            label: 'Live now',
            value: stats ? stats.active.toLocaleString() : '…',
            detail: 'seen in the last 30 minutes',
            tone: stats && stats.active > 0 ? 'live' : undefined,
          },
          { label: 'Completed', value: stats ? stats.completed.toLocaleString() : '…', detail: 'finished visits' },
          { label: 'Recorded', value: total !== null ? total.toLocaleString() : '…', detail: siteName ? `on ${siteName}` : 'across all sites' },
        ]}
      />

      <FiltersBar
        filter={filter}
        onChange={set}
        onPendingChange={setTyping}
        countries={countries}
        extra={
          <Select
            className="site-picker"
            ariaLabel="Site"
            value={String(selected)}
            onChange={(v) => setSelected(v === 'all' ? 'all' : Number(v))}
            options={[
              { value: 'all', label: 'All sites' },
              ...(sites ?? []).map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      {sites !== null && sites.length === 0 ? (
        <EmptyState
          title="No sites yet"
          description="Create a site first — its sessions will show up here."
          action={
            <Link to="/sites" className="btn btn--primary btn--md">
              Go to sites
            </Link>
          }
        />
      ) : sessions === null || searching || typing ? (
        // Old rows are never left on screen during a search: they read as the
        // answer to the new query when they are not.
        <Loading label={sessions === null ? 'Loading…' : 'Searching sessions…'} />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No sessions match"
          description="Install the site snippet and visit the site — sessions show up here within seconds."
        />
      ) : (
        <>
          <Table
            className="sessions-table"
            headers={['Visitor', 'Journey', 'Device', 'Location', 'Length', 'Started', '']}
            headerClassNames={[undefined, undefined, 'col-fit', 'col-fit', 'col-fit col-end', 'col-fit', 'col-fit']}
          >
            {groups.map((group, gi) => {
              const label = dayLabel(group.startedAt);
              const start = groups.slice(0, gi).reduce((n, g) => n + g.count, 0);
              return (
                <Fragment key={group.key}>
                  <tr className="sessions-day">
                    <td colSpan={7}>
                      <strong>{label.title}</strong>
                      <span>{label.detail}</span>
                      <span className="sessions-day__count">
                        {group.count.toLocaleString()} {group.count === 1 ? 'session' : 'sessions'}
                        {gi === groups.length - 1 && hasMore ? ' loaded' : ''}
                      </span>
                    </td>
                  </tr>
                  {sessions.slice(start, start + group.count).map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      showSite={showSite}
                      from={from}
                      actionFilter={filter.action ?? ''}
                      onViewed={() => markCachedSessionViewed(s.id)}
                      onOpen={() => navigate(replayPath(s.id, { action: filter.action }), { state: { from } })}
                    />
                  ))}
                </Fragment>
              );
            })}
          </Table>
          <div ref={loadMoreRef} className="sessions-load-more" aria-live="polite">
            {loadingMore ? (
              <Loading label="Loading older sessions…" />
            ) : loadMoreError ? (
              <>
                <span className="muted small">{loadMoreError}</span>
                <Button variant="ghost" size="sm" onClick={() => void loadMore()}>Retry</Button>
              </>
            ) : hasMore ? (
              <span className="muted small">{sessions.length.toLocaleString()} loaded · Scroll for older sessions · {SESSION_PAGE_SIZE} per request</span>
            ) : (
              <span className="muted small">All {sessions.length.toLocaleString()} matching sessions loaded</span>
            )}
          </div>
        </>
      )}
    </main>
  );
}
