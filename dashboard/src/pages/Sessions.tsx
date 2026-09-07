import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, Session, SessionFilter, Site } from '../api';
import { fmtDuration, fmtTime, stripProto, truncate } from '../lib/format';
import PageHeader from '../components/ui/PageHeader';
import Table from '../components/ui/Table';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import FiltersBar from '../components/sessions/FiltersBar';
import { Icon } from '../components/ui/Icon';
import { Input, Select } from '../components/ui/fields';
import './Sessions.css';

type SiteSelection = number | 'all';

// Global sessions browser: every session across every site, filterable per
// site or in aggregate. /sessions?site=N deep-links preselect the site.
export default function Sessions() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SiteSelection>(
    params.get('site') ? Number(params.get('site')) : 'all',
  );
  const [filter, setFilter] = useState<SessionFilter>({});
  const [stats, setStats] = useState<{ active: number; completed: number } | null>(null);

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    const site = params.get('site');
    if (site) setSelected(Number(site));
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    api
      .listSessions(selected === 'all' ? null : selected, filter)
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load sessions.');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, filter]);

  useEffect(() => {
    api
      .sessionStats(selected === 'all' ? null : selected)
      .then(setStats)
      .catch(() => setStats(null));
  }, [selected]);

  const set = (patch: Partial<SessionFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const showSite = selected === 'all';
  const visitorOf = (s: Session) => s.user_id || s.remote_id || s.client_id || '';

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
            <Link to="/" className="btn btn--primary btn--md">
              Go to sites
            </Link>
          }
        />
      ) : sessions === null ? (
        <Loading />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No sessions match"
          description="Install the site snippet and visit the site — sessions show up here within seconds."
        />
      ) : (
        <Table
          fixed
          widths={
            showSite
              ? ['11%', '11%', '12%', '10%', '8%', '9%', '8%', '9%', '7%', '8%', '64px']
              : ['12%', '11%', '11%', '8%', '9%', '8%', '9%', '7%', '8%', '64px']
          }
          headers={
            showSite
              ? ['Started', 'Status', 'Site', 'Visitor', 'Referrer', 'Browser', 'OS', 'Device', 'Pages', 'Length', '']
              : ['Started', 'Status', 'Visitor', 'Referrer', 'Browser', 'OS', 'Device', 'Pages', 'Length', '']
          }
        >
          {sessions.map((s) => (
            <tr key={s.id} className="is-clickable" onClick={() => navigate(`/replay/${s.id}`)}>
              <td className="muted">{fmtTime(s.started_at)}</td>
              <td>
                <Badge tone={s.active ? 'accent' : 'neutral'}>
                  {s.active ? 'in-progress' : 'completed'}
                </Badge>
              </td>
              {showSite && <td>{s.site_name ?? '—'}</td>}
              <td className="mono small muted" title={visitorOf(s)}>
                {truncate(visitorOf(s) || 'anonymous', 22)}
              </td>
              <td title={s.referrer} className="muted small">
                {s.referrer ? truncate(stripProto(s.referrer), 26) : '—'}
              </td>
              <td>{s.browser}</td>
              <td>{s.os}</td>
              <td>{s.device}</td>
              <td>{s.page_count}</td>
              <td>
                <span className="chip">{fmtDuration(s.duration_ms)}</span>
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <Link
                  to={`/replay/${s.id}?autoplay=1`}
                  className="btn btn--primary btn--sm play-btn"
                  aria-label={`Play session from ${fmtTime(s.started_at)}`}
                  title="Play recording"
                >
                  <Icon name="play" size={12} />
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </main>
  );
}
