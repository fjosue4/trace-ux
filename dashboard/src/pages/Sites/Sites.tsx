import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import AddSiteModal from '../../components/sites/AddSiteModal';
import { Icon } from '../../components/ui/Icon';
import SiteRow from '../../components/sites/SiteRow';
import { useSites } from './hooks/useSites';
import './Sites.scss';

export default function Sites() {
  const navigate = useNavigate();
  const { sites, error, load, pendingDelete, setPendingDelete, deleting, confirmDelete } = useSites();
  const [adding, setAdding] = useState(false);

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
          navigate(`/sites/site/${site.id}`);
        }}
      />
    </main>
  );
}
