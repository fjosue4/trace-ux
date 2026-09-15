import { FormEvent, useState } from 'react';
import { Role } from '../../../../api';
import { AddUserModalProps } from '../AddUserModal.types';

export function useAddUserModal(onClose: () => void, onCreate: AddUserModalProps['onCreate']) {
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

  return { username, setUsername, password, setPassword, role, setRole, error, busy, close, submit };
}
