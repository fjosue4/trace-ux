import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import { Field, Input } from '../../components/ui/fields';
import Logo from '../../components/ui/Logo';
import { useLogin } from './hooks/useLogin';
import './Login.scss';

export default function Login() {
  const { username, setUsername, password, setPassword, error, busy, submit } = useLogin();

  return (
    <main className="center">
      <Card className="login-card">
        <div className="login-brand">
          <Logo className="login-logo" title="TraceUX" />
        </div>
        <p className="muted login-sub">Self-hosted session replay</p>
        <form onSubmit={submit} className="stack">
          <Field label="Username">
            <Input
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              required
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" block disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="muted small login-hint">
          Leave the username empty to sign in as the admin with the <code>TRACE_UX_PASSWORD</code>.
        </p>
      </Card>
    </main>
  );
}
