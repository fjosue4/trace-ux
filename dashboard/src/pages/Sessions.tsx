import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, Session, SessionFilter, Site } from '../api';
import { fmtDuration, fmtTime, formatCountry, stripProto, truncate } from '../lib/format';
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
  const [countries, setCountries] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SiteSelection>(
    params.get('site') ? Number(params.get('site')) : 'all',
  );
  const [filter, setFilter] = useState<SessionFilter>({});
  const [stats, setStats] = useState<{ active: number; completed: number } | null>(null);

  useEffect(() => {
    setCountries([]);
    api
      .listSessionCountries(selected === 'all' ? null : selected)
      .then(setCountries)
      .catch(() => setCountries([]));
  }, [selected]);

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
          className="sessions-table"
          widths={
            showSite
              ? ['19%', '28%', '18%', '15%', '13%', '64px']
              : ['19%', '30%', '18%', '15%', '13%', '64px']
          }
          headers={
            showSite
              ? ['Visit', 'Context', 'Device', 'Country', 'Pages', '']
              : ['Visit', 'Visitor / referrer', 'Device', 'Country', 'Pages', '']
          }
        >
          {sessions.map((s) => (
            <tr key={s.id} className="is-clickable" onClick={() => navigate(`/replay/${s.id}`)}>
              <td>
                <div className="session-cell session-cell--visit">
                  <span className="session-cell__primary">{fmtTime(s.started_at)}</span>
                  <span className="session-cell__status">
                    <Badge tone={s.active ? 'accent' : 'neutral'}>
                      {s.active ? 'in-progress' : 'completed'}
                    </Badge>
                  </span>
                </div>
              </td>
              <td>
                <div className="session-context" title={s.referrer || 'direct'}>
                  <span className="session-context__icon" aria-hidden>
                    <Icon name="globe" size={13} />
                  </span>
                  <div className="session-cell session-cell--context">
                    {showSite && <span className="session-cell__primary">{s.site_name ?? '—'}</span>}
                    <span className={`${showSite ? 'session-cell__meta' : 'session-cell__primary'} mono`} title={visitorOf(s)}>
                      {truncate(visitorOf(s) || 'anonymous', 26)}
                    </span>
                    <span className="session-cell__meta session-cell__meta--truncate">
                      Referrer {s.referrer ? truncate(stripProto(s.referrer), 28) : 'direct'}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <div className="session-cell" title={[s.device, s.browser, s.os].filter(Boolean).join(' · ')}>
                  <span className="session-cell__primary">{s.device || '—'}</span>
                  <span className="session-cell__meta">{s.browser || '—'}</span>
                  <span className="session-cell__meta">{s.os || '—'}</span>
                </div>
              </td>
              <td>
                <div className="session-cell session-cell--country" title={s.country || 'Country unavailable'}>
                  <span className="session-cell__primary">{formatCountry(s.country)}</span>
                  {s.country && <span className="session-cell__meta mono">{s.country}</span>}
                </div>
              </td>
              <td>
                <div className="session-cell session-cell--pages">
                  <span className="session-cell__primary session-cell__primary--plain">
                    {s.page_count} {s.page_count === 1 ? 'page' : 'pages'}
                  </span>
                  <span className="session-cell__meta">
                    <strong>Length</strong> {fmtDuration(s.duration_ms)}
                  </span>
                </div>
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
