import { Ticket, TicketStatus } from '../../api';
import type { BadgeProps } from '../../components/ui/Badge';
import { statusOptions } from './Tickets.constants';
import { SiteSelection, StatusSelection } from './Tickets.types';

type BadgeTone = NonNullable<BadgeProps['tone']>;

export function statusLabel(status: TicketStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

export function statusTone(status: TicketStatus): BadgeTone {
  if (status === 'in_progress') return 'info';
  if (status === 'under_review') return 'warn';
  if (status === 'closed') return 'quiet';
  return 'accent';
}

export function compactTime(unix: number): string {
  if (!unix) return '—';
  const at = new Date(unix * 1000);
  const now = new Date();
  const sameDay =
    at.getDate() === now.getDate() && at.getMonth() === now.getMonth() && at.getFullYear() === now.getFullYear();
  if (sameDay) return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (at.getFullYear() === now.getFullYear()) {
    return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return at.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
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
