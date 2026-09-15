import { useEffect, useState } from 'react';
import { api, Role, User } from '../../../../api';

export function useUserManager() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);

  async function load() {
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load users.');
    }
  }
  useEffect(() => {
    load();
  }, []);

  function onEvent(message: string, tone: 'success' | 'error') {
    if (tone === 'error') {
      setError(message);
      setNotice('');
    } else {
      setNotice(message);
      setError('');
      setTimeout(() => setNotice(''), 2500);
    }
  }

  async function create(username: string, password: string, role: Role) {
    await api.createUser(username, password, role);
    onEvent(`User "${username}" created.`, 'success');
    setAdding(false);
    load();
  }

  return { users, error, notice, adding, setAdding, load, onEvent, create };
}
