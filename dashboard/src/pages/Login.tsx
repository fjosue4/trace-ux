import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      navigate('/');
    } catch {
      setError('Wrong password. Check WS_PASSWORD on the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card login-card" onSubmit={submit}>
        <h1>
          <span className="brand-dot" /> Webshots
        </h1>
        <p className="muted">Self-hosted session replay</p>
        <input
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">
          The password is set with the <code>WS_PASSWORD</code> environment variable.
        </p>
      </form>
    </main>
  );
}
