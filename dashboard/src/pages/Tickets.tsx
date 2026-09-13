import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, Site, Ticket, TicketMessage, TicketStatus, TicketThread } from '../api';
import { fmtClock, fmtTime } from '../lib/format';
import { useUser } from '../App';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Loading from '../components/ui/Loading';
import Notice from '../components/ui/Notice';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Icon } from '../components/ui/Icon';
import { Input, Select } from '../components/ui/fields';
import './Tickets.css';

type SiteSelection = number | 'all';
type StatusSelection = TicketStatus | 'all';
const ticketPollIntervalMs = 15_000;

type DashboardTicketEvent = {
  type?: string;
  id?: number;
  ticket?: Ticket;
  message?: TicketMessage;
};

const statusOptions: { value: StatusSelection; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'under_review', label: 'Under review' },
  { value: 'closed', label: 'Closed' },
];

function statusLabel(status: TicketStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function statusTone(status: TicketStatus): 'accent' | 'neutral' | 'danger' {
  if (status === 'closed') return 'neutral';
  if (status === 'under_review') return 'danger';
  return 'accent';
}

function requester(ticket: Ticket) {
  return ticket.name || ticket.email || ticket.user_id || 'Anonymous visitor';
}

function ticketMatchesFilters(ticket: Ticket, siteSel: SiteSelection, statusSel: StatusSelection) {
  return (siteSel === 'all' || ticket.site_id === siteSel) && (statusSel === 'all' || ticket.status === statusSel);
}

function sortTickets(rows: Ticket[]) {
  return [...rows].sort((a, b) => b.last_message_at - a.last_message_at || b.id - a.id);
}

function Thread({
  thread,
  userRole,
  onStatus,
  onReply,
  onDelete,
  sending,
}: {
  thread: TicketThread;
  userRole: string;
  onStatus: (status: TicketStatus) => void;
  onReply: (body: string) => Promise<void>;
  onDelete: () => void;
  sending: boolean;
}) {
  const [body, setBody] = useState('');
  const [replyError, setReplyError] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const { ticket, messages } = thread;

  useEffect(() => {
    setBody('');
    setReplyError('');
  }, [ticket.id, messages.length]);

  useLayoutEffect(() => {
    const messagesPane = messagesRef.current;
    if (messagesPane) messagesPane.scrollTop = messagesPane.scrollHeight;
  }, [ticket.id, messages.length]);

  async function submitReply() {
    const value = body.trim();
    if (!value) {
      setReplyError('Write a reply before sending.');
      return;
    }
    if (value.length > 4000) {
      setReplyError('Replies must be 4,000 characters or fewer.');
      return;
    }
    setReplyError('');
    try {
      await onReply(value);
    } catch {
      setReplyError('Could not send the reply.');
    }
  }

  return (
    <div className="ticket-thread">
      <div className="ticket-thread__header">
        <div className="ticket-thread__title-row">
          <div>
            <span className="ticket-kicker">Ticket #{ticket.id}</span>
            <h2>{ticket.subject}</h2>
          </div>
          <Select
            className="ticket-status-select"
            ariaLabel="Ticket status"
            value={ticket.status}
            onChange={(value) => onStatus(value as TicketStatus)}
            options={statusOptions.filter((option) => option.value !== 'all')}
          />
        </div>
        <div className="ticket-thread__meta">
          <span>{requester(ticket)}</span>
          {ticket.email && ticket.name && <span>{ticket.email}</span>}
          <span>Opened {fmtTime(ticket.created_at)}</span>
          {ticket.page_url && (
            <a href={ticket.page_url} target="_blank" rel="noreferrer" className="ticket-link">
              Current page ↗
            </a>
          )}
          {ticket.session_id && (
            <Link to={`/replay/${ticket.session_id}`} className="ticket-link">
              <Icon name="play" size={11} /> Replay
            </Link>
          )}
        </div>
      </div>

      <div ref={messagesRef} className="ticket-messages">
        {messages.map((message) => (
          <div key={message.id} className={`ticket-message ticket-message--${message.author}`}>
            <div className="ticket-message__meta">
              <strong>{message.author === 'staff' ? message.author_name || 'Staff' : requester(ticket)}</strong>
              <span>{fmtClock(message.created_at) || fmtTime(message.created_at)}</span>
            </div>
            <p>{message.body}</p>
          </div>
        ))}
      </div>

      {ticket.status === 'closed' ? (
        <div className="ticket-closed-note">This ticket is closed. Reopen it to continue the conversation.</div>
      ) : (
        <div className="ticket-reply">
          <textarea
            value={body}
            maxLength={4000}
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder="Reply to the visitor…"
            aria-label="Reply to ticket"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submitReply();
            }}
          />
          <div className="ticket-reply__bottom">
            <span className="muted small">⌘↵ to send</span>
            {replyError && <span className="ticket-form-error">{replyError}</span>}
            <Button size="sm" onClick={() => void submitReply()} disabled={sending || !body.trim()}>
              {sending ? 'Sending…' : 'Send reply'}
              {!sending && <Icon name="send" size={12} />}
            </Button>
          </div>
        </div>
      )}

      {userRole === 'admin' && (
        <div className="ticket-thread__danger">
          <Button size="sm" variant="dangerGhost" onClick={onDelete}>
            <Icon name="trash" size={13} /> Delete ticket
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Tickets() {
  const { user } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteSel, setSiteSel] = useState<SiteSelection>('all');
  const [statusSel, setStatusSel] = useState<StatusSelection>('all');
  const [items, setItems] = useState<Ticket[] | null>(null);
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState(false);
  const selectedId = Number(searchParams.get('ticket')) || null;
  const selectedIdRef = useRef<number | null>(selectedId);
  const siteSelRef = useRef<SiteSelection>(siteSel);
  const statusSelRef = useRef<StatusSelection>(statusSel);
  const refreshTicketsRef = useRef<() => void>(() => {});
  const refreshThreadRef = useRef<() => void>(() => {});
  const dashboardSocketConnectedRef = useRef(false);

  selectedIdRef.current = selectedId;
  siteSelRef.current = siteSel;
  statusSelRef.current = statusSel;

  const siteOptions = useMemo(
    () => [{ value: 'all', label: 'All sites' }, ...sites.map((site) => ({ value: String(site.id), label: site.name }))],
    [sites],
  );

  useEffect(() => {
    api.listSites().then(setSites).catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError('');

    const fetchTickets = async (initial: boolean) => {
      try {
        const rows = await api.listTickets(siteSel === 'all' ? null : siteSel, statusSel === 'all' ? '' : statusSel);
        if (!cancelled) setItems(rows);
      } catch {
        // A transient polling failure should not replace a usable inbox. Show
        // the error only for the initial load, when there is no data yet.
        if (!cancelled && initial) setError('Could not load tickets.');
      }
    };

    const refresh = () => {
      if (!cancelled && document.visibilityState === 'visible') void fetchTickets(false);
    };
    refreshTicketsRef.current = refresh;
    void fetchTickets(true);
    const poll = window.setInterval(() => {
      if (!dashboardSocketConnectedRef.current) refresh();
    }, ticketPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (refreshTicketsRef.current === refresh) refreshTicketsRef.current = () => {};
    };
  }, [siteSel, statusSel]);

  useEffect(() => {
    if (!selectedId) {
      setThread(null);
      setLoadingThread(false);
      refreshThreadRef.current = () => {};
      return;
    }
    let cancelled = false;
    setLoadingThread(true);
    const fetchThread = async (initial: boolean) => {
      try {
        const value = await api.getTicket(selectedId);
        if (!cancelled) setThread(value);
      } catch {
        // Keep the current conversation visible if a background poll fails.
        if (!cancelled && initial) {
          setThread(null);
          setError('Could not load that ticket.');
        }
      } finally {
        if (!cancelled && initial) setLoadingThread(false);
      }
    };

    const refresh = () => {
      if (!cancelled && document.visibilityState === 'visible') void fetchThread(false);
    };
    refreshThreadRef.current = refresh;
    void fetchThread(true);
    const poll = window.setInterval(() => {
      if (!dashboardSocketConnectedRef.current) refresh();
    }, ticketPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (refreshThreadRef.current === refresh) refreshThreadRef.current = () => {};
    };
  }, [selectedId]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let retryDelay = 1_000;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (disposed) return;
      retryTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15_000);
    };

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(`${protocol}//${window.location.host}/api/tickets/socket`);
      socket = nextSocket;
      nextSocket.addEventListener('open', () => {
        if (disposed || socket !== nextSocket) {
          nextSocket.close();
          return;
        }
        dashboardSocketConnectedRef.current = true;
        retryDelay = 1_000;
        // Reconcile anything that changed while a previous connection was
        // down before relying on direct event updates again.
        refreshTicketsRef.current();
        refreshThreadRef.current();
      });
      nextSocket.addEventListener('message', (event) => {
        if (disposed || socket !== nextSocket || typeof event.data !== 'string') return;
        let payload: DashboardTicketEvent;
        try {
          payload = JSON.parse(event.data) as DashboardTicketEvent;
        } catch {
          return;
        }
        if (!payload.type?.startsWith('ticket.')) return;

        if (payload.type === 'ticket.deleted') {
          const id = Number(payload.id);
          if (!Number.isFinite(id) || id <= 0) return;
          setItems((current) => current?.filter((item) => item.id !== id) ?? current);
          if (selectedIdRef.current === id) {
            setThread(null);
            setSearchParams({});
          }
          return;
        }

        const ticket = payload.ticket;
        if (!ticket) return;
        setItems((current) => {
          if (!current) return current;
          const remaining = current.filter((item) => item.id !== ticket.id);
          if (!ticketMatchesFilters(ticket, siteSelRef.current, statusSelRef.current)) return remaining;
          return sortTickets([ticket, ...remaining]).slice(0, 100);
        });

        if (selectedIdRef.current !== ticket.id) return;
        const incomingMessage = payload.message;
        if (payload.type === 'ticket.message' && incomingMessage) {
          setThread((current) => {
            if (!current || current.ticket.id !== ticket.id) return current;
            if (current.messages.some((item) => item.id === incomingMessage.id)) return { ...current, ticket };
            return { ...current, ticket, messages: [...current.messages, incomingMessage] };
          });
        } else {
          setThread((current) => (current && current.ticket.id === ticket.id ? { ...current, ticket } : current));
        }
      });
      nextSocket.addEventListener('error', () => nextSocket.close());
      nextSocket.addEventListener('close', () => {
        if (socket !== nextSocket) return;
        dashboardSocketConnectedRef.current = false;
        scheduleReconnect();
      });
    };

    connect();
    return () => {
      disposed = true;
      dashboardSocketConnectedRef.current = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
      socket = null;
    };
  }, [setSearchParams]);

  function openTicket(id: number) {
    setSearchParams({ ticket: String(id) });
  }

  async function updateStatus(status: TicketStatus) {
    if (!thread || status === thread.ticket.status) return;
    try {
      const updated = await api.updateTicket(thread.ticket.id, status);
      setThread((current) => (current ? { ...current, ticket: updated } : current));
      setItems((current) => current?.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)) ?? current);
    } catch {
      setError('Could not update the ticket status.');
    }
  }

  async function reply(body: string) {
    if (!thread) return;
    setSending(true);
    try {
      const updated = await api.replyToTicket(thread.ticket.id, body);
      setThread(updated);
      setItems((current) => current?.map((item) => (item.id === updated.ticket.id ? updated.ticket : item)) ?? current);
    } finally {
      setSending(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteTicket(pendingDelete.id);
      setItems((current) => current?.filter((item) => item.id !== pendingDelete.id) ?? current);
      if (selectedId === pendingDelete.id) setSearchParams({});
      setPendingDelete(null);
      setThread(null);
    } catch {
      setError('Could not delete the ticket.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page tickets-page">
      <PageHeader
        title="Tickets"
        subtitle="Keep visitor support conversations in one place, with replay context close at hand."
      />

      <div className="tickets-toolbar">
        <Select ariaLabel="Site" value={String(siteSel)} onChange={(value) => setSiteSel(value === 'all' ? 'all' : Number(value))} options={siteOptions} />
        <Select ariaLabel="Status" value={statusSel} onChange={(value) => setStatusSel(value as StatusSelection)} options={statusOptions} />
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="tickets-layout">
        <Card className="tickets-list-card">
          <div className="tickets-list-card__head">
            <div>
              <span className="eyebrow">Inbox</span>
              <h2>{items ? `${items.length} ticket${items.length === 1 ? '' : 's'}` : 'Tickets'}</h2>
            </div>
            <Icon name="lifebuoy" size={20} />
          </div>
          {items === null ? (
            <Loading />
          ) : items.length === 0 ? (
            <EmptyState title="No tickets here" description="Visitor conversations will appear here when your support widget is enabled." icon={<Icon name="lifebuoy" size={20} />} />
          ) : (
            <div className="ticket-list">
              {items.map((ticket) => (
                <button
                  type="button"
                  key={ticket.id}
                  className={`ticket-row${selectedId === ticket.id ? ' is-selected' : ''}`}
                  onClick={() => openTicket(ticket.id)}
                >
                  <span className="ticket-row__top">
                    <strong>{ticket.subject}</strong>
                    <Badge tone={statusTone(ticket.status)}>{statusLabel(ticket.status)}</Badge>
                  </span>
                  <span className="ticket-row__bottom">
                    <span className={`ticket-row__dot${ticket.last_message_author === 'visitor' ? ' is-waiting' : ''}`} aria-hidden />
                    <span>{requester(ticket)}</span>
                    <span>·</span>
                    <span>{fmtTime(ticket.last_message_at)}</span>
                  </span>
                  {siteSel === 'all' && ticket.site_name && <span className="ticket-row__site">{ticket.site_name}</span>}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="ticket-thread-card">
          {loadingThread ? (
            <Loading />
          ) : thread ? (
            <Thread
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
    </main>
  );
}
