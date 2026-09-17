import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TicketStatus, TicketThread } from '../../../api';
import { fmtClock, fmtTime } from '../../../lib/format';
import Button from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';
import { Select } from '../../../components/ui/fields';
import { statusOptions } from '../Tickets.constants';
import { requester } from '../Tickets.helpers';

type TicketThreadViewProps = {
  thread: TicketThread;
  userRole: string;
  onStatus: (status: TicketStatus) => void;
  onReply: (body: string) => Promise<void>;
  onArchive: () => void;
  archiving: boolean;
  sending: boolean;
};

export function TicketThreadView({ thread, userRole, onStatus, onReply, onArchive, archiving, sending }: TicketThreadViewProps) {
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
            disabled={ticket.status === 'archived' && userRole !== 'admin'}
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
      ) : ticket.status === 'archived' ? (
        <div className="ticket-closed-note">This ticket is archived. Its conversation is retained for transparency.</div>
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

      {userRole === 'admin' && ticket.status !== 'archived' && (
        <div className="ticket-thread__archive">
          <Button size="sm" variant="secondary" onClick={onArchive} disabled={archiving}>
            <Icon name="archive" size={13} /> {archiving ? 'Archiving…' : 'Archive ticket'}
          </Button>
        </div>
      )}
    </div>
  );
}
