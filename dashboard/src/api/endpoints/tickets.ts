import { request } from '../client';
import { Ticket, TicketStatus, TicketThread } from '../types/tickets';

export const ticketsEndpoints = {
  // Support tickets.
  listTickets: (siteId: number | null, status: TicketStatus | '') => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (status) q.set('status', status);
    return request<Ticket[]>(`/api/tickets${q.toString() ? `?${q}` : ''}`);
  },
  getTicket: (id: number) => request<TicketThread>(`/api/tickets/${id}`),
  createTicket: (input: {
    site_id: number;
    visitor_key: string;
    email: string;
    subject: string;
    body: string;
    user_id?: string;
    name?: string;
    session_id?: string;
  }) => request<Ticket>('/api/tickets', { method: 'POST', body: JSON.stringify(input) }),
  replyToTicket: (id: number, body: string) =>
    request<TicketThread>(`/api/tickets/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  updateTicket: (id: number, status: TicketStatus) =>
    request<Ticket>(`/api/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteTicket: (id: number) => request<{ ok: boolean }>(`/api/tickets/${id}`, { method: 'DELETE' }),
};
