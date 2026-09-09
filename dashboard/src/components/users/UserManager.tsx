import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api, Role, User } from '../../api';
import { fadeUp } from '../../lib/motion';
import Button from '../ui/Button';
import Notice from '../ui/Notice';
import Table from '../ui/Table';
import { Field, Input, Select, SelectOption } from '../ui/fields';
import { Icon } from '../ui/Icon';
import UserRow, { ROLE_OPTIONS } from './UserRow';
import './UserManager.css';

// Admin-only team management, embedded in Settings. The server enforces admin
// rights and protects the last admin; this component mirrors those rules.
export default function UserManager() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');

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

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || password.length < 8) {
      onEvent('Username required; password needs at least 8 characters.', 'error');
      return;
    }
    try {
      await api.createUser(username.trim(), password, role);
      onEvent(`User "${username.trim()}" created.`, 'success');
      setUsername('');
      setPassword('');
      setRole('viewer');
      setAdding(false);
      load();
    } catch (err) {
      onEvent(err instanceof Error ? err.message : 'Could not create user.', 'error');
    }
  }

  return (
    <motion.div className="user-manager" variants={fadeUp} initial="hidden" animate="visible">
      <div className="row row--between">
        <p className="muted small">
          Admins manage users and sites; viewers browse sites, sessions and replays. Changing a
          password or role signs that user out everywhere.
        </p>
        <Button size="sm" onClick={() => setAdding(!adding)}>
          <Icon name={adding ? 'x' : 'plus'} size={13} />
          {adding ? 'Cancel' : 'Add user'}
        </Button>
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <AnimatePresence initial={false}>
      {adding && (
        <motion.form onSubmit={create} className="row row--wrap user-manager__create" initial={{ opacity: 0, height: 0, y: -6 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0, y: -6 }}>
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
          <Field label="Password" hint="Minimum 8 characters">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Role">
            <Select value={role} options={ROLE_OPTIONS} onChange={(v) => setRole(v as Role)} ariaLabel="Role" />
          </Field>
          <Button type="submit">Create</Button>
        </motion.form>
      )}
      </AnimatePresence>

      {users === null ? (
        <Notice tone="info">Loading users…</Notice>
      ) : (
        <Table className="users-table" fixed widths={['25%', '18%', '22%', '35%']} headers={['User', 'Role', 'Created', '']}>
          {users.map((u) => (
            <UserRow key={u.id} user={u} onEvent={onEvent} onChanged={load} />
          ))}
        </Table>
      )}
    </motion.div>
  );
}
