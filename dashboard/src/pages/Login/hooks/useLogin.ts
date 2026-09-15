import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api';
import { useAuth } from '../../../auth/auth';

export function useLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { onSignIn } = useAuth();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(username.trim() || 'admin', password);
      onSignIn(res.user); // shell (sidebar) appears without a refresh
      navigate('/');
    } catch {
      setError('Wrong username or password.');
    } finally {
      setBusy(false);
    }
  }

  return { username, setUsername, password, setPassword, error, busy, submit };
}
