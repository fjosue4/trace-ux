import { Ticket } from '../../../api';
import { fmtTime } from '../../../lib/format';
import Badge from '../../../components/ui/Badge';
import { requester, statusLabel, statusTone } from '../Tickets.helpers';

type TicketRowProps = {
  ticket: Ticket;
  isSelected: boolean;
  showSite: boolean;
  onOpen: (id: number) => void;
};

export function TicketRow({ ticket, isSelected, showSite, onOpen }: TicketRowProps) {
  return (
    <button
      type="button"
      className={`ticket-row${isSelected ? ' is-selected' : ''}`}
      onClick={() => onOpen(ticket.id)}
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
      {showSite && ticket.site_name && <span className="ticket-row__site">{ticket.site_name}</span>}
    </button>
  );
}
