import { Ticket, TicketMessage, TicketStatus } from '../../api';
import type { BadgeProps } from '../../components/ui/Badge';
import { messageGroupGapSeconds, statusOptions } from './Tickets.constants';
import { InboxSection, MessageDay, SiteSelection, TicketView } from './Tickets.types';

type BadgeTone = NonNullable<BadgeProps['tone']>;

export function statusLabel(status: TicketStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

export function statusTone(status: TicketStatus): BadgeTone {
  if (status === 'in_progress') return 'info';
  if (status === 'under_review') return 'warn';
  return 'quiet';
}

/** Which inbox tab a ticket belongs to. */
export function viewOf(ticket: Ticket): Exclude<TicketView, 'all'> {
  return ticket.status === 'closed' || ticket.status === 'archived' ? ticket.status : 'open';
}

/** The visitor wrote last on a ticket that is still being worked on. */
export function needsReply(ticket: Ticket) {
  return viewOf(ticket) === 'open' && ticket.last_message_author === 'visitor';
}

export function compactTime(unix: number): string {
  if (!unix) return '—';
  const at = new Date(unix * 1000);
  const now = new Date();
  if (at.toDateString() === now.toDateString()) return clockTime(unix);
  if (at.getFullYear() === now.getFullYear()) {
    return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return at.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function clockTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Yesterday", or the date, for the separators in a conversation. */
export function dayLabel(unix: number, now = new Date()): string {
  const at = new Date(unix * 1000);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return at.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function requester(ticket: Ticket) {
  const name = ticket.name?.trim() ?? '';
  const email = ticket.email?.trim() ?? '';
  const userId = ticket.user_id?.trim() ?? '';
  const identity = name || userId || email;
  if (!identity) return 'Anonymous visitor';
  if (email && identity.toLowerCase() !== email.toLowerCase()) return `${identity} <${email}>`;
  return identity;
}

export function ticketMatchesSite(ticket: Ticket, siteSel: SiteSelection) {
  return siteSel === 'all' || ticket.site_id === siteSel;
}

export function sortTickets(rows: Ticket[]) {
  return [...rows].sort((a, b) => b.last_message_at - a.last_message_at || b.id - a.id);
}

export function countByView(tickets: Ticket[]): Record<TicketView, number> {
  const counts: Record<TicketView, number> = { open: 0, closed: 0, archived: 0, all: tickets.length };
  for (const ticket of tickets) counts[viewOf(ticket)] += 1;
  return counts;
}

function matchesSearch(ticket: Ticket, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [ticket.subject, requester(ticket), ticket.site_name ?? '', `#${ticket.id}`].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

/**
 * The rows of one inbox tab. Open tickets split into the ones waiting on staff
 * (longest wait first, so nothing sinks) and the ones waiting on the visitor;
 * every other tab is a single list, newest activity first.
 */
export function inboxSections(tickets: Ticket[], view: TicketView, query: string): InboxSection[] {
  const rows = sortTickets(tickets.filter((t) => (view === 'all' || viewOf(t) === view) && matchesSearch(t, query)));
  if (view !== 'open') return rows.length ? [{ key: view, tickets: rows }] : [];
  const waitingOnStaff = rows.filter(needsReply).reverse();
  const waitingOnVisitor = rows.filter((t) => !needsReply(t));
  return [
    { key: 'needs-reply', title: 'Needs reply', tone: 'attention' as const, tickets: waitingOnStaff },
    { key: 'waiting', title: 'Waiting on visitor', tickets: waitingOnVisitor },
  ].filter((section) => section.tickets.length > 0);
}

/** A conversation as days of author groups, so names and dates appear once. */
export function messageDays(messages: TicketMessage[], ticket: Ticket, now = new Date()): MessageDay[] {
  const days: MessageDay[] = [];
  for (const message of messages) {
    const label = dayLabel(message.created_at, now);
    let day = days[days.length - 1];
    if (!day || day.label !== label) {
      day = { key: `${label}-${message.id}`, label, groups: [] };
      days.push(day);
    }
    const group = day.groups[day.groups.length - 1];
    const last = group?.messages[group.messages.length - 1];
    const name = message.author === 'staff' ? message.author_name || 'Staff' : requester(ticket);
    if (group && last && group.author === message.author && group.name === name && message.created_at - last.created_at <= messageGroupGapSeconds) {
      group.messages.push(message);
    } else {
      day.groups.push({ key: `group-${message.id}`, author: message.author, name, at: message.created_at, messages: [message] });
    }
  }
  return days;
}
