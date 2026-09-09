import { useState } from 'react';
import { motion } from 'motion/react';
import { api, Role, User } from '../../api';
import { fadeUp } from '../../lib/motion';
import { fmtTime } from '../../lib/format';
import { Input, Select, SelectOption } from '../ui/fields';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import { InlineSpinner } from '../ui/Loading';
import './UserRow.css';

export const ROLE_OPTIONS: SelectOption[] = [
  { value: 'viewer', label: 'viewer' },
  { value: 'admin', label: 'admin' },
];

type Props = {
  user: User;
  currentUsername: string;
  onEvent: (message: string, tone: 'success' | 'error') => void;
  onChanged: () => void;
};

// One row of the admin Users table. The row owns its password-editing state
// and talks to the API itself; the page just refreshes and shows messages.
export default function UserRow({ user, currentUsername, onEvent, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isCurrentUser = user.username.toLowerCase() === currentUsername.toLowerCase();

  async function resetPassword() {
    if (newPassword.length < 8) {
      onEvent('Password needs at least 8 characters.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.updateUser(user.id, { password: newPassword });
      setEditing(false);
      setNewPassword('');
      onEvent(`Password reset — ${user.username} has been logged out.`, 'success');
      onChanged();
    } catch (e) {
      onEvent(e instanceof Error ? e.message : 'Could not reset password.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(role: Role) {
    if (role === user.role) return;
    try {
      await api.updateUser(user.id, { role });
      onEvent(`${user.username} is now ${role === 'admin' ? 'an admin' : 'a viewer'}.`, 'success');
      onChanged();
    } catch (e) {
      onEvent(e instanceof Error ? e.message : 'Could not change role.', 'error');
      onChanged();
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api.deleteUser(user.id);
      onEvent('User deleted.', 'success');
      onChanged();
    } catch (e) {
      onEvent(e instanceof Error ? e.message : 'Could not delete user.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <motion.tr variants={fadeUp} initial="hidden" animate="visible" layout>
      <td className="mono">
        {user.username}
        {user.role === 'admin' && (
          <span className="badge-row">
            <Badge tone="accent">admin</Badge>
          </span>
        )}
      </td>
      <td>
        <Select
          ariaLabel={`Role for ${user.username}${isCurrentUser ? ' (your own role cannot be changed)' : ''}`}
          value={user.role}
          options={ROLE_OPTIONS}
          disabled={isCurrentUser}
          onChange={(v) => changeRole(v as Role)}
        />
      </td>
      <td className="muted">{fmtTime(user.created_at)}</td>
      <td className="user-row__actions">
        {editing ? (
          <span className="inline-edit">
            <Input
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
              autoComplete="new-password"
            />
            <Button size="sm" onClick={resetPassword} disabled={saving}>
              {saving ? <InlineSpinner /> : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(true);
                setNewPassword('');
              }}
            >
              Set password
            </Button>
            <Button variant="dangerGhost" size="sm" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </>
        )}
      </td>
      <ConfirmDialog
        open={confirming}
        title={`Delete "${user.username}"?`}
        description="Their dashboard access ends immediately. Sites and recordings are not affected."
        confirmLabel="Delete user"
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      />
    </motion.tr>
  );
}
