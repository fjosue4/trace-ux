import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api, Role, User } from '../../api';
import { fadeUp } from '../../lib/motion';
import Button from '../ui/Button';
import Notice from '../ui/Notice';
import Table from '../ui/Table';
import { Icon } from '../ui/Icon';
import UserRow from './UserRow';
import AddUserModal from './AddUserModal';
import './UserManager.css';

// Admin-only team management, embedded in Settings. The server enforces admin
// rights and protects the last admin; this component mirrors those rules.
type Props = { currentUsername: string };

export default function UserManager({ currentUsername }: Props) {
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

  return (
    <motion.div className="user-manager" variants={fadeUp} initial="hidden" animate="visible">
      <div className="row row--between">
        <p className="muted small">
          Admins manage users and sites; viewers browse sites, sessions and replays. Changing a
          password or role signs that user out everywhere.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          Add user
        </Button>
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <AddUserModal open={adding} onClose={() => setAdding(false)} onCreate={create} />

      {users === null ? (
        <Notice tone="info">Loading users…</Notice>
      ) : (
        <Table className="users-table" fixed widths={['25%', '18%', '22%', '35%']} headers={['User', 'Role', 'Created', '']}>
          {users.map((u) => (
            <UserRow key={u.id} user={u} currentUsername={currentUsername} onEvent={onEvent} onChanged={load} />
          ))}
        </Table>
      )}
    </motion.div>
  );
}
