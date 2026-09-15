import { Role } from '../../../api';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import Notice from '../../ui/Notice';
import { Field, Input, Select } from '../../ui/fields';
import { ROLE_OPTIONS } from '../UserRow';
import { useAddUserModal } from './hooks/useAddUserModal';
import { AddUserModalProps } from './AddUserModal.types';
import './AddUserModal.scss';

export default function AddUserModal({ open, onClose, onCreate }: AddUserModalProps) {
  const { username, setUsername, password, setPassword, role, setRole, error, busy, close, submit } =
    useAddUserModal(onClose, onCreate);

  return (
    <Modal open={open} onClose={close} title="Add user" footer={(
      <>
        <Button variant="secondary" type="button" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form="add-user-form" disabled={busy}>
          {busy ? 'Creating…' : 'Create user'}
        </Button>
      </>
    )}>
      <form id="add-user-form" className="add-user-modal__form" onSubmit={submit}>
        <p className="muted small add-user-modal__intro">
          Create an account and choose whether it can manage TraceUX or only browse it.
        </p>
        <div className="add-user-modal__fields">
          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              disabled={busy}
            />
          </Field>
          <Field label="Role">
            <Select value={role} options={ROLE_OPTIONS} onChange={(value) => setRole(value as Role)} ariaLabel="Role" disabled={busy} />
          </Field>
          <Field label="Password" hint="Minimum 8 characters">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
