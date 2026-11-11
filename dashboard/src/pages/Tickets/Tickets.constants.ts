import { TicketStatus } from '../../api';
import { TicketView } from './Tickets.types';

export const ticketPollIntervalMs = 15_000;

// Every tab is filtered from one loaded list, so the list asks for the most
// the server will return.
export const ticketListLimit = 200;

export const statusOptions: { value: TicketStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'under_review', label: 'Under review' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
];

export const ticketViews: { value: TicketView; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

// A new message within this long of the previous one, from the same author,
// joins its group instead of repeating the name line.
export const messageGroupGapSeconds = 5 * 60;
