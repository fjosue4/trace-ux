import { FormEvent, useState } from 'react';
import { api } from '../../../api';

export function useChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (next.length < 8) {
      setError('New password needs at least 8 characters.');
      return;
    }
    if (next !== confirmPw) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirmPw('');
      setNotice('Password updated. Your other sessions were signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  }

  return { current, setCurrent, next, setNext, confirmPw, setConfirmPw, error, notice, busy, submit };
}
