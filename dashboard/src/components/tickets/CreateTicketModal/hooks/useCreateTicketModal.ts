import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import { CreateTicketModalProps } from '../CreateTicketModal.types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useCreateTicketModal({
  showModal,
  toggleModalOpen,
  siteId,
  visitorKey,
  userId,
  email: knownEmail,
  name,
  sessionId,
  defaultSubject,
  defaultBody,
  onCreated,
}: CreateTicketModalProps) {
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Reopening must not show the previous draft, and the known email is only a
  // starting point — the operator can correct it before sending.
  useEffect(() => {
    if (!showModal) return;
    // A user_id is an opaque id from the host page, but it is very often the
    // person's email. Offer it when it looks like one; the operator can still
    // correct it before sending.
    const seed = knownEmail || (userId && EMAIL_PATTERN.test(userId) ? userId : '');
    setEmail(seed);
    setSubject(defaultSubject ?? '');
    setBody(defaultBody ?? '');
    setError('');
    setBusy(false);
  }, [showModal, knownEmail, userId, defaultSubject, defaultBody]);

  const canSave =
    !busy && EMAIL_PATTERN.test(email.trim()) && subject.trim().length > 0 && body.trim().length > 0;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      const ticket = await api.createTicket({
        site_id: siteId,
        visitor_key: visitorKey,
        user_id: userId || undefined,
        name: name || undefined,
        session_id: sessionId || undefined,
        email: email.trim(),
        subject: subject.trim(),
        body: body.trim(),
      });
      onCreated?.(ticket.id);
      toggleModalOpen();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the ticket.');
      setBusy(false);
    }
  }

  return { email, setEmail, subject, setSubject, body, setBody, error, busy, canSave, save };
}
