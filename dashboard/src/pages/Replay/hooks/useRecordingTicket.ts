import { useEffect, useState } from 'react';
import { api, SessionContact, Ticket } from '../../../api';

/**
 * Opening a ticket from a recording. The visitor's widget key is looked up
 * only when asked, since most recordings are never followed up; the ticket
 * modal then takes over.
 */
export function useRecordingTicket(sessionId: string | undefined) {
  const [contact, setContact] = useState<SessionContact | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Ticket | null>(null);

  // Another recording starts clean: its visitor is someone else.
  useEffect(() => {
    setContact(null);
    setError('');
    setCreated(null);
  }, [sessionId]);

  async function open() {
    if (!sessionId || looking) return;
    setLooking(true);
    setError('');
    setCreated(null);
    try {
      setContact(await api.getSessionContact(sessionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not look up this visitor.');
    } finally {
      setLooking(false);
    }
  }

  return { contact, looking, error, created, open, close: () => setContact(null), onCreated: setCreated };
}
