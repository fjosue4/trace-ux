import { useUser } from '../../App';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Loading from '../../components/ui/Loading';
import Notice from '../../components/ui/Notice';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Icon } from '../../components/ui/Icon';
import { useTickets } from './hooks/useTickets';
import { TicketRow } from './subcomponents/TicketRow';
import { TicketThreadView } from './subcomponents/TicketThreadView';
import { TicketFiltersModal } from './subcomponents/TicketFiltersModal';
import './Tickets.scss';

export default function Tickets() {
  const { user } = useUser();
  const {
    siteSel,
    setSiteSel,
    statusSel,
    setStatusSel,
    items,
    thread,
    loadingThread,
    sending,
    error,
    pendingDelete,
    setPendingDelete,
    deleting,
    filtersOpen,
    setFiltersOpen,
    selectedId,
    siteOptions,
    openTicket,
    updateStatus,
    reply,
    confirmDelete,
  } = useTickets();

  return (
    <main className="page tickets-page">
      <PageHeader
        title="Tickets"
        subtitle="Keep visitor support conversations in one place, with replay context close at hand."
      />

      {error && <Notice tone="error">{error}</Notice>}

      <div className="tickets-layout">
        <Card className="tickets-list-card">
          <div className="tickets-list-card__head">
            <div>
              <span className="eyebrow">Inbox</span>
              <h2>{items ? `${items.length} ticket${items.length === 1 ? '' : 's'}` : 'Tickets'}</h2>
            </div>
            <button
              type="button"
              className={`icon-btn tickets-filter-button${siteSel !== 'all' || statusSel !== 'all' ? ' is-active' : ''}`}
              aria-label="Filter tickets"
              aria-haspopup="dialog"
              title="Filter tickets"
              onClick={() => setFiltersOpen(true)}
            >
              <Icon name="filter" size={18} />
            </button>
          </div>
          {items === null ? (
            <Loading />
          ) : items.length === 0 ? (
            <EmptyState title="No tickets here" description="Visitor conversations will appear here when your support widget is enabled." icon={<Icon name="lifebuoy" size={20} />} />
          ) : (
            <div className="ticket-list">
              {items.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} isSelected={selectedId === ticket.id} showSite={siteSel === 'all'} onOpen={openTicket} />
              ))}
            </div>
          )}
        </Card>

        <Card className="ticket-thread-card">
          {loadingThread ? (
            <Loading />
          ) : thread ? (
            <TicketThreadView
              thread={thread}
              userRole={user.role}
              onStatus={updateStatus}
              onReply={reply}
              onDelete={() => setPendingDelete(thread.ticket)}
              sending={sending}
            />
          ) : (
            <EmptyState title="Select a ticket" description="Choose a conversation from the inbox to read and reply." icon={<Icon name="message" size={20} />} />
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this ticket?"
        description={pendingDelete ? <>Ticket #{pendingDelete.id} and its entire conversation will be removed permanently.</> : ''}
        confirmLabel="Delete ticket"
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />

      <TicketFiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        siteSel={siteSel}
        setSiteSel={setSiteSel}
        statusSel={statusSel}
        setStatusSel={setStatusSel}
        siteOptions={siteOptions}
      />
    </main>
  );
}
