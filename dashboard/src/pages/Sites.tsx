import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Site } from '../api';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import AddSiteModal from '../components/sites/AddSiteModal';
import { Icon } from '../components/ui/Icon';
import SiteRow from '../components/sites/SiteRow';
import './Sites.css';

export default function Sites() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
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

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteSite(pendingDelete.id);
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
          <Button onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Add site
          </Button>
        }
      />

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

      <AddSiteModal
        open={adding}
        origin={location.origin}
        onClose={() => setAdding(false)}
        onCreated={load}
        onConfigureSite={(site) => {
          setAdding(false);
          navigate(`/site/${site.id}`);
        }}
      />
    </main>
  );
}
