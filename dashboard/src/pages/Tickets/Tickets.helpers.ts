import { Ticket, TicketStatus } from '../../api';
import { statusOptions } from './Tickets.constants';
import { SiteSelection, StatusSelection } from './Tickets.types';

export function statusLabel(status: TicketStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

export function statusTone(status: TicketStatus): 'accent' | 'neutral' | 'danger' {
  if (status === 'closed') return 'neutral';
  if (status === 'under_review') return 'danger';
  return 'accent';
}

export function requester(ticket: Ticket) {
  return ticket.name || ticket.email || ticket.user_id || 'Anonymous visitor';
}

export function ticketMatchesFilters(ticket: Ticket, siteSel: SiteSelection, statusSel: StatusSelection) {
  return (siteSel === 'all' || ticket.site_id === siteSel) && (statusSel === 'all' || ticket.status === statusSel);
}

export function sortTickets(rows: Ticket[]) {
  return [...rows].sort((a, b) => b.last_message_at - a.last_message_at || b.id - a.id);
}
