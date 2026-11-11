import { Ticket, TicketMessage } from '../../api';

export type SiteSelection = number | 'all';

/** The inbox tabs. "open" covers every status still being worked on. */
export type TicketView = 'open' | 'closed' | 'archived' | 'all';

/** A titled run of inbox rows; the title is omitted when a tab has one group. */
export type InboxSection = { key: string; title?: string; tone?: 'attention'; tickets: Ticket[] };

/** Consecutive messages from one author, shown under a single name line. */
export type MessageGroup = { key: string; author: TicketMessage['author']; name: string; at: number; messages: TicketMessage[] };

/** One calendar day of a conversation. */
export type MessageDay = { key: string; label: string; groups: MessageGroup[] };

export type DashboardTicketEvent = {
  type?: string;
  id?: number;
  ticket?: Ticket;
  message?: TicketMessage;
};
