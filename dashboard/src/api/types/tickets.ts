export type TicketStatus = 'open' | 'in_progress' | 'under_review' | 'closed';
export type Ticket = {
  id: number;
  site_id: number;
  site_name?: string;
  user_id?: string;
  email?: string;
  name?: string;
  subject: string;
  status: TicketStatus;
  session_id?: string;
  page_url?: string;
  message_count: number;
  last_message_at: number;
  last_message_author: 'visitor' | 'staff';
  created_at: number;
  updated_at: number;
};
export type TicketMessage = {
  id: number;
  ticket_id: number;
  author: 'visitor' | 'staff';
  user_id: number;
  author_name?: string;
  body: string;
  created_at: number;
};
export type TicketThread = {
  ticket: Ticket;
  messages: TicketMessage[];
};
