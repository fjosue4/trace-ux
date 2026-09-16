import { motion } from 'motion/react';
import { Role } from '../../../api';
import { fadeUp } from '../../../lib/motion';
import { fmtTime } from '../../../lib/format';
import { Input, Select, SelectOption } from '../../ui/fields';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { InlineSpinner } from '../../ui/Loading';
import { useUserRow } from './hooks/useUserRow';
import { UserRowProps } from './UserRow.types';
import './UserRow.scss';

export const ROLE_OPTIONS: SelectOption[] = [
  { value: 'viewer', label: 'viewer' },
  { value: 'admin', label: 'admin' },
];

// One row of the admin Users table. The row owns its password-editing state
// and talks to the API itself; the page just refreshes and shows messages.
export default function UserRow({ user, currentUsername, onEvent, onChanged }: UserRowProps) {
  const {
    editing,
    newPassword,
    setNewPassword,
    saving,
    confirming,
    setConfirming,
    deleting,
    startEditing,
    stopEditing,
    resetPassword,
    changeRole,
    remove,
  } = useUserRow({ user, onEvent, onChanged });
  const isCurrentUser = user.username.toLowerCase() === currentUsername.toLowerCase();

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
            <Button variant="ghost" size="sm" onClick={stopEditing}>
              Cancel
            </Button>
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={startEditing}>
              Set password
            </Button>
            {isCurrentUser ? (
              <span className="muted small user-row__current">Current account</span>
            ) : (
              <Button variant="dangerGhost" size="sm" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            )}
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
