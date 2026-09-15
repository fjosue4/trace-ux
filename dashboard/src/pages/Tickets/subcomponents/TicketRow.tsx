import { Ticket } from '../../../api';
import Badge from '../../../components/ui/Badge';
import { compactTime, requester, statusLabel, statusTone } from '../Tickets.helpers';

type TicketRowProps = {
  ticket: Ticket;
  isSelected: boolean;
  showSite: boolean;
  onOpen: (id: number) => void;
};

export function TicketRow({ ticket, isSelected, showSite, onOpen }: TicketRowProps) {
  const isWaiting = ticket.last_message_author === 'visitor';
  const subtitle = [requester(ticket), showSite ? ticket.site_name : ''].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={`ticket-row${isSelected ? ' is-selected' : ''}${isWaiting ? ' is-waiting' : ''}`}
      onClick={() => onOpen(ticket.id)}
    >
      <span className="ticket-row__stripe" aria-hidden />
      <span className="ticket-row__body">
        <span className="ticket-row__title">
          {isWaiting && <span className="ticket-row__flag" aria-hidden />}
          <strong>{ticket.subject}</strong>
        </span>
        <span className="ticket-row__sub">{subtitle}</span>
      </span>
      <span className="ticket-row__aside">
        {isWaiting && <span className="visually-hidden">Waiting on a reply</span>}
        <Badge tone={statusTone(ticket.status)}>{statusLabel(ticket.status)}</Badge>
        <span className="ticket-row__when">{compactTime(ticket.last_message_at)}</span>
      </span>
    </button>
  );
}
