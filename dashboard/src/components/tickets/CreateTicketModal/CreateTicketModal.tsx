import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import { Field, Input } from '../../ui/fields';
import { CreateTicketModalProps } from './CreateTicketModal.types';
import { useCreateTicketModal } from './hooks/useCreateTicketModal';
import './CreateTicketModal.scss';

export default function CreateTicketModal(props: CreateTicketModalProps) {
  const { showModal, toggleModalOpen, userId } = props;
  const { email, setEmail, subject, setSubject, body, setBody, error, busy, canSave, save } =
    useCreateTicketModal(props);

  return (
    <Modal
      className="create-ticket-modal"
      open={showModal}
      onClose={toggleModalOpen}
      title="Start a ticket"
      footer={<Button onClick={save} disabled={!canSave}>{busy ? 'Creating…' : 'Create ticket'}</Button>}
    >
      <p className="create-ticket-modal__intro">
        The ticket appears in this visitor's widget the next time they open your site. TraceUX does
        not send email — the address is stored so you can reach them if they don't come back.
      </p>

      <Field label="Email" hint={userId ? `Identified as ${userId}` : 'This visitor was never identified, so an address is the only way to contact them'}>
        <Input
          type="email"
          value={email}
          placeholder="visitor@example.com"
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field label="Subject">
        <Input
          value={subject}
          maxLength={120}
          placeholder="What is this about?"
          onChange={(event) => setSubject(event.target.value)}
        />
      </Field>

      <Field label="Message">
        <textarea
          className="create-ticket-modal__body"
          value={body}
          maxLength={4000}
          rows={5}
          placeholder="Write the first message…"
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </Modal>
  );
}
