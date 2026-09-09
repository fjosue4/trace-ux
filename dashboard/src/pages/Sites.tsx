import { FormEvent, useEffect, useState } from 'react';
import { api, Site } from '../api';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Icon } from '../components/ui/Icon';
import { Input } from '../components/ui/fields';
import SiteRow from '../components/sites/SiteRow';
import SnippetCard from '../components/sites/SnippetCard';
import './Sites.css';

export default function Sites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [justCreated, setJustCreated] = useState<Site | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    try {
      const site = await api.createSite(name.trim(), url.trim());
      setJustCreated(site);
      setName('');
      setUrl('');
      setAdding(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create site.');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteSite(pendingDelete.id);
      if (justCreated?.id === pendingDelete.id) setJustCreated(null);
      setPendingDelete(null);
      load();
    } catch {
      setError('Could not delete site.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page">
      <PageHeader
        title="Sites"
        actions={
          <Button onClick={() => setAdding(!adding)}>
            <Icon name={adding ? 'x' : 'plus'} size={14} />
            {adding ? 'Cancel' : 'Add site'}
          </Button>
        }
      />

      {justCreated && (
        <SnippetCard
          site={justCreated}
          origin={location.origin}
          onDismiss={() => setJustCreated(null)}
        />
      )}

      {adding && (
        <Card className="add-site">
          <form onSubmit={create} className="stack">
            <div className="row">
              <Input
                placeholder="Site name (e.g. Acme Shop)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <Input
                placeholder="https://your-site.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                inputMode="url"
              />
              <Button type="submit">Create</Button>
            </div>
            <p className="muted small">
              The URL is the address where you'll paste the snippet — recordings are only accepted
              from that origin.
            </p>
          </form>
        </Card>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {sites === null ? (
        <Loading />
      ) : sites.length === 0 ? (
        <EmptyState
          title="No sites yet"
          description="Create a site, paste the snippet into your website, and sessions will appear here."
          action={
            <Button onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              Add your first site
            </Button>
          }
        />
      ) : (
        <Card className="site-list card--static">
          {sites.map((s) => (
            <SiteRow key={s.id} site={s} origin={location.origin} onDelete={setPendingDelete} />
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name ?? ''}"?`}
        description="This permanently removes the site and all of its recorded sessions. This cannot be undone."
        confirmLabel="Delete site"
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </main>
  );
}
