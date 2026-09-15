export interface CreateTicketModalProps {
  showModal: boolean;
  toggleModalOpen: () => void;
  siteId: number;
  visitorKey: string;
  userId?: string;
  email?: string;
  name?: string;
  sessionId?: string;
  defaultSubject?: string;
  defaultBody?: string;
  onCreated?: (ticketId: number) => void;
}
