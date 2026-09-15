import { Ticket, TicketMessage, TicketStatus } from '../../api';

export type SiteSelection = number | 'all';
export type StatusSelection = TicketStatus | 'all';

export type DashboardTicketEvent = {
  type?: string;
  id?: number;
  ticket?: Ticket;
  message?: TicketMessage;
};
