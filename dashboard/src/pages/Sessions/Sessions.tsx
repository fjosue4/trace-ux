import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Table from '../../components/ui/Table';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import FiltersBar from '../../components/sessions/FiltersBar';
import { Select } from '../../components/ui/fields';
import { markCachedSessionViewed, useSessions } from './hooks/useSessions';
import { SessionRow } from './subcomponents/SessionRow';
import { SESSION_PAGE_SIZE } from './Sessions.constants';
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

  return (
    <main className="page">
      <PageHeader title="Sessions" />

      <div className="session-stats">
        <Card className="session-stat">
          <span className="session-stat__label">
            <span className="session-stat__dot session-stat__dot--live" aria-hidden />
            Active sessions
          </span>
          <strong className="session-stat__num">{stats ? stats.active : '…'}</strong>
        </Card>
        <Card className="session-stat">
          <span className="session-stat__label">
            <span className="session-stat__dot session-stat__dot--done" aria-hidden />
            Completed sessions
          </span>
          <strong className="session-stat__num">{stats ? stats.completed : '…'}</strong>
        </Card>
      </div>

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
            fixed
            className="sessions-table"
            widths={
              showSite
                ? ['19%', '28%', '18%', '15%', '13%', '64px']
                : ['19%', '30%', '18%', '15%', '13%', '64px']
            }
            headers={
              showSite
                ? ['Visit', 'Context', 'Device', 'Country', 'Actions', '']
                : ['Visit', 'Visitor / referrer', 'Device', 'Country', 'Actions', '']
            }
          >
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                showSite={showSite}
                from={from}
                onViewed={() => markCachedSessionViewed(s.id)}
                onOpen={() => navigate(`/replay/${s.id}`, { state: { from } })}
              />
            ))}
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
