import { FormEvent, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { spring } from '../lib/motion';
import { useUser } from '../App';
import { Theme, useTheme } from '../hooks/useTheme';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Notice from '../components/ui/Notice';
import Badge from '../components/ui/Badge';
import { Field, Input } from '../components/ui/fields';
import UserManager from '../components/users/UserManager';
import './Settings.css';

// Signed-in users manage appearance here. Admins manage account passwords from
// the full-width Team list; viewers keep the self-service password form.
export default function Settings() {
  const { user } = useUser();
  const { theme, setTheme } = useTheme();
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

  return (
    <main className="page settings">
      <PageHeader title="Settings" />

      <Card>
        <h3>Profile</h3>
        <div className="settings__profile">
          <span className="mono settings__username">{user.username}</span>
          <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role}</Badge>
        </div>
        <p className="muted small">
          {user.role === 'admin'
            ? 'You can manage users and sites as an admin.'
            : 'You can browse sites, sessions and replays. An admin manages users.'}
        </p>
      </Card>

      <Card>
        <h3>Appearance</h3>
        <p className="muted small">Choose how TraceUX looks on this device.</p>
        <div className="seg" role="group" aria-label="Theme">
          {(['light', 'dark'] as Theme[]).map((t) => (
            <motion.button
              key={t}
              className={`seg__option${theme === t ? ' is-active' : ''}`}
              onClick={() => setTheme(t)}
              whileTap={{ scale: 0.96 }}
              transition={spring}
            >
              {t === 'light' ? 'Light' : 'Dark'}
            </motion.button>
          ))}
        </div>
      </Card>

      {user.role === 'admin' && (
        <Card className="settings__team">
          <h3>Team</h3>
          <p className="muted small">
            As an admin you can create users, reset passwords, switch roles and remove accounts.
          </p>
          <UserManager />
        </Card>
      )}

      {user.role !== 'admin' && (
        <Card>
          <h3>Change password</h3>
          <form onSubmit={submit} className="stack settings__pw">
            <Field label="Current password">
              <Input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password" hint="Minimum 8 characters">
              <Input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Repeat new password">
              <Input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            {notice && <Notice tone="success">{notice}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}
