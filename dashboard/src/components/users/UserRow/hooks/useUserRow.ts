import { useState } from 'react';
import { api, Role } from '../../../../api';
import { UserRowProps } from '../UserRow.types';

export function useUserRow({ user, onEvent, onChanged }: Pick<UserRowProps, 'user' | 'onEvent' | 'onChanged'>) {
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  function startEditing() {
    setEditing(true);
    setNewPassword('');
  }

  return {
    editing,
    newPassword,
    setNewPassword,
    saving,
    confirming,
    setConfirming,
    deleting,
    startEditing,
    stopEditing: () => setEditing(false),
    resetPassword,
    changeRole,
    remove,
  };
}
