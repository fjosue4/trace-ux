import { motion } from 'motion/react';
import { fadeUp } from '../../../lib/motion';
import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Table from '../../ui/Table';
import { Icon } from '../../ui/Icon';
import UserRow from '../UserRow';
import AddUserModal from '../AddUserModal';
import { useUserManager } from './hooks/useUserManager';
import { UserManagerProps } from './UserManager.types';
import './UserManager.scss';

// Admin-only team management, embedded in Settings. The server enforces admin
// rights and protects the last admin; this component mirrors those rules.
export default function UserManager({ currentUsername }: UserManagerProps) {
  const { users, error, notice, adding, setAdding, load, onEvent, create } = useUserManager();

  return (
    <motion.div className="user-manager" variants={fadeUp} initial="hidden" animate="visible">
      <div className="row row--between">
        <p className="muted small">
          Admins manage users and sites; viewers browse sites, sessions and replays. Changing a
          password or role signs that user out everywhere. You cannot remove the user you are signed in as.
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
