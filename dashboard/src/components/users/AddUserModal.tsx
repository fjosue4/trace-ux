import { FormEvent, useState } from 'react';
import { Role } from '../../api';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Notice from '../ui/Notice';
import { Field, Input, Select } from '../ui/fields';
import { ROLE_OPTIONS } from './UserRow';
import './AddUserModal.css';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (username: string, password: string, role: Role) => Promise<void>;
};

export default function AddUserModal({ open, onClose, onCreate }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setUsername('');
    setPassword('');
    setRole('viewer');
    setError('');
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nextUsername = username.trim();
    if (!nextUsername || password.length < 8) {
      setError('Username required; password needs at least 8 characters.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onCreate(nextUsername, password, role);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create user.');
    } finally {
      setBusy(false);
    }
  }

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
