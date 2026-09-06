import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, Session, SessionFilter, fmtDuration, fmtTime, truncate } from '../api';

export default function Sessions() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<SessionFilter>({});

  const query = useMemo(() => JSON.stringify(filter), [filter]);

  useEffect(() => {
    if (!siteId) return;
    api
      .listSessions(Number(siteId), JSON.parse(query))
      .then(setSessions)
      .catch(() => setError('Could not load sessions.'));
  }, [siteId, query]);

  const set = (patch: Partial<SessionFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <main className="page">
      <div className="page-head">
        <h1>Sessions</h1>
        <Link to="/" className="muted">
          ← All sites
        </Link>
      </div>

      <div className="filters">
        <select value={filter.device || ''} onChange={(e) => set({ device: e.target.value })}>
          <option value="">Any device</option>
          <option value="desktop">Desktop</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
        </select>
        <select value={filter.browser || ''} onChange={(e) => set({ browser: e.target.value })}>
          <option value="">Any browser</option>
          {['Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', 'Bot', 'Other'].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select value={filter.os || ''} onChange={(e) => set({ os: e.target.value })}>
          <option value="">Any OS</option>
          {['macOS', 'Windows', 'iOS', 'Android', 'Linux', 'ChromeOS'].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select
          value={filter.min_duration_ms || 0}
          onChange={(e) => set({ min_duration_ms: Number(e.target.value) || undefined })}
        >
          <option value={0}>Any length</option>
          <option value={30000}>30s+</option>
          <option value={120000}>2m+</option>
          <option value={600000}>10m+</option>
        </select>
        <input
          placeholder="Filter by URL contains…"
          value={filter.url || ''}
          onChange={(e) => set({ url: e.target.value || undefined })}
        />
      </div>

      {error && <div className="error">{error}</div>}
      {sessions === null ? (
        <div className="loading">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="empty card">
          <h2>No sessions match</h2>
          <p className="muted">
            Install the site snippet and visit the site — sessions show up here within seconds.
          </p>
        </div>
      ) : (
        <table className="sessions">
          <thead>
            <tr>
              <th>Started</th>
              <th>Entry page</th>
              <th>Referrer</th>
              <th>Browser</th>
              <th>OS</th>
              <th>Device</th>
              <th>Pages</th>
              <th>Length</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} onClick={() => navigate(`/replay/${s.id}`)} className="row">
                <td>{fmtTime(s.started_at)}</td>
                <td title={s.initial_url}>{truncate(s.initial_url.replace(/^https?:\/\//, ''), 42)}</td>
                <td title={s.referrer}>
                  {s.referrer ? truncate(s.referrer.replace(/^https?:\/\//, ''), 26) : '—'}
                </td>
                <td>{s.browser}</td>
                <td>{s.os}</td>
                <td>{s.device}</td>
                <td>{s.page_count}</td>
                <td>
                  <strong>{fmtDuration(s.duration_ms)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
