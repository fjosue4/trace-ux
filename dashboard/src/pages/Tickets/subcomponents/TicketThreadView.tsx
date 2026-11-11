import { Link } from 'react-router-dom';
import { TicketStatus, TicketThread } from '../../../api';
import { useClipboardCopy } from '../../../hooks/useClipboardCopy';
import { fmtTime } from '../../../lib/format';
import Button from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';
import { Select } from '../../../components/ui/fields';
import { statusOptions } from '../Tickets.constants';
import { requester } from '../Tickets.helpers';
import { TicketComposer } from './TicketComposer';
import { TicketMessages } from './TicketMessages';

type TicketThreadViewProps = {
  thread: TicketThread;
  isAdmin: boolean;
  onStatus: (status: TicketStatus) => void;
  onReply: (body: string, thenClose?: boolean) => Promise<void>;
  onArchive: () => void;
  /** Leaves the conversation; shown where the inbox is not beside it. */
  onBack: () => void;
  archiving: boolean;
  sending: boolean;
};

/** One ticket: who and where, the conversation, and what can be done next. */
export function TicketThreadView({ thread, isAdmin, onStatus, onReply, onArchive, onBack, archiving, sending }: TicketThreadViewProps) {
  const { ticket, messages } = thread;
  const { status: copyStatus, copy } = useClipboardCopy();
  const who = requester(ticket);
  const copyLabel = copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Could not copy. Try again.' : 'Copy requester';

  return (
    <div className="ticket-thread">
      <div className="ticket-thread__header">
        <div className="ticket-thread__title-row">
          <button type="button" className="icon-btn ticket-thread__back" aria-label="Back to tickets" onClick={onBack}>
            <Icon name="arrowLeft" size={16} />
          </button>
          <h2 title={ticket.subject}>
            <span className="ticket-thread__id">#{ticket.id}</span>
            {ticket.subject}
          </h2>
          <Select
            className="ticket-status-select"
            ariaLabel="Ticket status"
            value={ticket.status}
            onChange={(value) => onStatus(value as TicketStatus)}
            options={statusOptions}
            disabled={ticket.status === 'archived' && !isAdmin}
          />
          {isAdmin && ticket.status !== 'archived' && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Archive ticket"
              title={archiving ? 'Archiving…' : 'Archive ticket'}
              disabled={archiving}
              onClick={onArchive}
            >
              <Icon name="archive" size={16} />
            </button>
          )}
        </div>
        <div className="ticket-thread__meta">
          <span className="ticket-thread__requester">
            <span title={who}>{who}</span>
            <button type="button" className="ticket-thread__copy" aria-label={copyLabel} title={copyLabel} onClick={() => copy(ticket.email || who)}>
              <Icon name={copyStatus === 'copied' ? 'check' : 'copy'} size={11} />
            </button>
          </span>
          {ticket.site_name && <span>{ticket.site_name}</span>}
          <span>Opened {fmtTime(ticket.created_at)}</span>
          {ticket.page_url && (
            <a href={ticket.page_url} target="_blank" rel="noreferrer" className="ticket-link" title={ticket.page_url}>
              Page ↗
            </a>
          )}
          {ticket.session_id && (
            <Link to={`/replay/${ticket.session_id}`} className="ticket-link">
              <Icon name="play" size={10} /> Replay
            </Link>
          )}
        </div>
      </div>

      <TicketMessages ticket={ticket} messages={messages} />

      {ticket.status === 'closed' ? (
        <div className="ticket-resolution">
          <Icon name="check" size={14} />
          <span>This ticket is closed</span>
          <Button size="sm" variant="secondary" onClick={() => onStatus('open')}>
            Reopen
          </Button>
        </div>
      ) : ticket.status === 'archived' ? (
        <div className="ticket-resolution">
          <Icon name="archive" size={14} />
          <span>Archived. The conversation is kept for the record.</span>
        </div>
      ) : (
        <TicketComposer resetKey={`${ticket.id}:${messages.length}`} sending={sending} onReply={onReply} />
      )}
    </div>
  );
}
