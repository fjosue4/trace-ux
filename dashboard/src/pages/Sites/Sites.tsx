import { useNavigate } from 'react-router-dom';
import { useUser } from '../../App';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import StatStrip from '../../components/ui/StatStrip';
import Table from '../../components/ui/Table';
import { Icon } from '../../components/ui/Icon';
import SiteRow from '../../components/sites/SiteRow';
import { useSites } from './hooks/useSites';
import './Sites.scss';

export default function Sites() {
  const navigate = useNavigate();
  const { user } = useUser();
  const isAdmin = user.role === 'admin';
  const { sites, activity, error, pendingDelete, setPendingDelete, deleting, confirmDelete } = useSites();
  // Adding a site always goes through the guided setup; its first step offers
  // "Create and set up later" for anyone who wants to skip the guide.
  const addSite = () => navigate(sites?.length === 0 ? '/sites/setup?first=1' : '/sites/setup');

  const statsLoaded = sites !== null && sites.every((s) => activity[s.id] !== undefined);
  const live = sites?.reduce((sum, s) => sum + (activity[s.id]?.active ?? 0), 0) ?? 0;
  const liveSites = sites?.filter((s) => (activity[s.id]?.active ?? 0) > 0).length ?? 0;
  const recorded = sites?.reduce((sum, s) => sum + s.session_count, 0) ?? 0;
  const recordingOff = sites?.filter((s) => s.recording_enabled === false).length ?? 0;

  return (
    <main className="page">
      <PageHeader
        title="Sites"
        subtitle="Websites sending sessions to this TraceUX instance."
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
        <>
          <StatStrip
            items={[
              {
                label: 'Live visitors',
                value: statsLoaded ? live.toLocaleString() : '…',
                detail: statsLoaded ? (live > 0 ? `across ${liveSites} ${liveSites === 1 ? 'site' : 'sites'}` : 'No one on your sites right now') : ' ',
                tone: live > 0 ? 'live' : undefined,
              },
              { label: 'Recorded sessions', value: recorded.toLocaleString(), detail: 'across all sites' },
              {
                label: 'Sites',
                value: sites.length,
                detail: recordingOff > 0 ? `${recordingOff} with recording off` : 'All recording',
              },
            ]}
          />
          <Table
            className="sites-table"
            headers={['Site', 'Status', 'Sessions', 'Setup', 'Added', '']}
            headerClassNames={[undefined, undefined, 'col-end', undefined, undefined, 'col-fit']}
          >
            {sites.map((s, i) => (
              <SiteRow
                key={s.id}
                site={s}
                index={i}
                origin={location.origin}
                live={activity[s.id]?.active}
                canDelete={isAdmin}
                onDelete={setPendingDelete}
              />
            ))}
          </Table>
        </>
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
