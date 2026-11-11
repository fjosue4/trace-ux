import { useUser } from '../../App';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Loading from '../../components/ui/Loading';
import Notice from '../../components/ui/Notice';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Icon } from '../../components/ui/Icon';
import { useTickets } from './hooks/useTickets';
import { TicketInbox } from './subcomponents/TicketInbox';
import { TicketThreadView } from './subcomponents/TicketThreadView';
import './Tickets.scss';

// Support inbox: the ticket list on the left, the selected conversation on
// the right. On narrow screens the two take turns instead of sharing the row.
export default function Tickets() {
  const { user } = useUser();
  const {
    siteSel,
    setSiteSel,
    view,
    setView,
    query,
    setQuery,
    counts,
    sections,
    items,
    thread,
    loadingThread,
    sending,
    error,
    pendingArchive,
    setPendingArchive,
    archiving,
    selectedId,
    siteOptions,
    openTicket,
    closeTicket,
    updateStatus,
    reply,
    confirmArchive,
  } = useTickets();

  return (
    <main className="page tickets-page">
      {error && <Notice tone="error">{error}</Notice>}

      <div className={`tickets-layout${selectedId ? ' has-selection' : ''}`}>
        <Card className="tickets-list-card card--static">
          <TicketInbox
            tickets={items}
            sections={sections}
            counts={counts}
            view={view}
            onViewChange={setView}
            query={query}
            onQueryChange={setQuery}
            siteSel={siteSel}
            onSiteChange={setSiteSel}
            siteOptions={siteOptions}
            selectedId={selectedId}
            onOpen={openTicket}
          />
        </Card>

        <Card className="ticket-thread-card card--static">
          {loadingThread ? (
            <Loading />
          ) : thread ? (
            <TicketThreadView
              thread={thread}
              isAdmin={user.role === 'admin'}
              onStatus={updateStatus}
              onReply={reply}
              onArchive={() => setPendingArchive(thread.ticket)}
              onBack={closeTicket}
              archiving={archiving}
              sending={sending}
            />
          ) : (
            <EmptyState title="Select a ticket" description="Choose a conversation from the list to read and reply." icon={<Icon name="message" size={20} />} />
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={pendingArchive !== null}
        title="Archive this ticket?"
        description={pendingArchive ? <>Ticket #{pendingArchive.id} and its full conversation are kept for the record. You can reopen it later.</> : ''}
        confirmLabel="Archive ticket"
        busy={archiving}
        onConfirm={confirmArchive}
        onClose={() => setPendingArchive(null)}
      />
    </main>
  );
}
