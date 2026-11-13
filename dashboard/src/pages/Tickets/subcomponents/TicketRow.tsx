import { Ticket } from '../../../api';
import Badge from '../../../components/ui/Badge';
import { compactTime, needsReply, requester, statusLabel, statusTone } from '../Tickets.helpers';

type TicketRowProps = {
  ticket: Ticket;
  isSelected: boolean;
  showSite: boolean;
  /** Shown when the tab mixes statuses, or the status says more than the tab. */
  showStatus: boolean;
  onOpen: (id: number) => void;
};

/** One ticket in the inbox: subject and last activity, then who and where. */
export function TicketRow({ ticket, isSelected, showSite, showStatus, onOpen }: TicketRowProps) {
  const waiting = needsReply(ticket);
  const subtitle = [requester(ticket), showSite ? ticket.site_name : ''].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={`ticket-row${isSelected ? ' is-selected' : ''}${waiting ? ' is-waiting' : ''}`}
      aria-current={isSelected ? 'true' : undefined}
      onClick={() => onOpen(ticket.id)}
    >
      <span className="ticket-row__line">
        <strong className="ticket-row__subject">{ticket.subject}</strong>
        <span className="ticket-row__when">{compactTime(ticket.last_message_at)}</span>
      </span>
      <span className="ticket-row__line">
        <span className="ticket-row__sub">{subtitle}</span>
        {waiting && <Badge tone="warn">Needs reply</Badge>}
        {showStatus && <Badge tone={statusTone(ticket.status)}>{statusLabel(ticket.status)}</Badge>}
      </span>
    </button>
  );
}
