import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Site, fmtTime, truncate } from '../api';

export default function Sites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [justCreated, setJustCreated] = useState<Site | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      setSites(await api.listSites());
    } catch {
      setError('Could not load sites.');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const site = await api.createSite(name.trim());
      setJustCreated(site);
      setName('');
      setAdding(false);
      load();
    } catch {
      setError('Could not create site.');
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this site and all of its sessions?')) return;
    await api.deleteSite(id).catch(() => {});
    load();
  }

  const snippet = (s: Site) =>
    `<script async src="${location.origin}/t.js" data-site="${s.site_key}"></script>`;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Sites</h1>
        <button onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ Add site'}</button>
      </div>

      {justCreated && (
        <div className="card snippet-card">
          <h3>{justCreated.name} is ready</h3>
          <p className="muted">Paste this snippet into the {'<head>'} of every page:</p>
          <pre>{snippet(justCreated)}</pre>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(snippet(justCreated));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied ✓' : 'Copy snippet'}
          </button>
        </div>
      )}

      {adding && (
        <form className="card add-form" onSubmit={create}>
          <input
            placeholder="Site name (e.g. Acme Shop)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button>Create</button>
        </form>
      )}

      {error && <div className="error">{error}</div>}

      {sites === null ? (
        <div className="loading">Loading…</div>
      ) : sites.length === 0 ? (
        <div className="empty card">
          <h2>No sites yet</h2>
          <p className="muted">Create a site, paste the snippet into your website, and sessions will appear here.</p>
        </div>
      ) : (
        <div className="site-grid">
          {sites.map((s) => (
            <div key={s.id} className="card site-card">
              <div className="site-top">
                <Link to={`/site/${s.id}`} className="site-name">
                  {s.name}
                </Link>
                <button className="danger ghost" onClick={() => remove(s.id)}>
                  Delete
                </button>
              </div>
              <div className="muted small mono">{s.site_key}</div>
              <div className="site-stats">
                <span>
                  <strong>{s.session_count}</strong> sessions
                </span>
                <span className="muted">since {fmtTime(s.created_at)}</span>
              </div>
              <details>
                <summary className="muted small">Show snippet</summary>
                <pre>{snippet(s)}</pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
