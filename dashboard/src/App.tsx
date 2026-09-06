import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';

// App shell: checks auth once, renders the header + routed page.
export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          setAuthed(false);
          navigate('/login');
        } else {
          setAuthed(false);
        }
      });
  }, [navigate]);

  if (authed === null) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-dot" /> Webshots
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Sites
          </NavLink>
          <button
            className="linkish"
            onClick={async () => {
              await api.logout().catch(() => {});
              navigate('/login');
            }}
          >
            Log out
          </button>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
