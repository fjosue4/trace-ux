import type { Ticket } from '../../../api';

export interface CreateTicketModalProps {
  showModal: boolean;
  toggleModalOpen: () => void;
  siteId: number;
  visitorKey: string;
  userId?: string;
  email?: string;
  name?: string;
  sessionId?: string;
  /** The page the conversation is about. */
  pageUrl?: string;
  /** False when the visitor never used the widget, so the ticket can only
   *  be followed up by email. Defaults to true. */
  inWidget?: boolean;
  defaultSubject?: string;
  defaultBody?: string;
  onCreated?: (ticket: Ticket) => void;
}
