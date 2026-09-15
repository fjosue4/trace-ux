import { StatusSelection } from './Tickets.types';

export const ticketPollIntervalMs = 15_000;

export const statusOptions: { value: StatusSelection; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'under_review', label: 'Under review' },
  { value: 'closed', label: 'Closed' },
];
