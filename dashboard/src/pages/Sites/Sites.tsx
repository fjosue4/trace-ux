import { useNavigate } from 'react-router-dom';
import { useUser } from '../../App';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Icon } from '../../components/ui/Icon';
import SiteRow from '../../components/sites/SiteRow';
import { useSites } from './hooks/useSites';
import './Sites.scss';

export default function Sites() {
  const navigate = useNavigate();
  const { user } = useUser();
  const isAdmin = user.role === 'admin';
  const { sites, error, pendingDelete, setPendingDelete, deleting, confirmDelete } = useSites();
  // Adding a site always goes through the guided setup; its first step offers
  // "Create and set up later" for anyone who wants to skip the guide.
  const addSite = () => navigate(sites?.length === 0 ? '/sites/setup?first=1' : '/sites/setup');

  return (
    <main className="page">
      <PageHeader
        title="Sites"
        actions={
          isAdmin && (
            <Button onClick={addSite}>
              <Icon name="plus" size={14} />
              Add site
            </Button>
          )
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      {sites === null ? (
        <Loading />
      ) : sites.length === 0 ? (
        <EmptyState
          title={isAdmin ? 'Welcome to TraceUX' : 'No sites yet'}
          description={
            isAdmin
              ? 'Set up your first site step by step: the snippet, recordings, the visitor widget, logs, backend services, Slack alerts, and your team. Skip any step and come back to it later.'
              : 'An administrator has not added a site yet. Sessions will appear here once one is set up.'
          }
          action={
            isAdmin && (
              <Button onClick={addSite}>
                <Icon name="plus" size={14} />
                Set up your first site
              </Button>
            )
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
