import { useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { api, ApiError, CurrentUser } from './api';
import { AuthContext } from './auth/auth';
import Sidebar from './components/layout/Sidebar';
import Loading from './components/ui/Loading';
import './App.css';

export type AppContext = { user: CurrentUser };

// Pages read the logged-in user via this hook (e.g. admin-only UI).
export function useUser(): AppContext {
  return useOutletContext<AppContext>();
}

// App shell: resolve auth before rendering protected content, then keep the
// login route outside the dashboard chrome. Login reports back through
// AuthContext so the shell appears immediately after signing in, without a
// refresh.
export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checked, setChecked] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useMemo(() => ({ onSignIn: (u: CurrentUser) => setUser(u) }), []);
  const isLogin = location.pathname === '/login';
  const isPublicShare = location.pathname.startsWith('/share/');

  useEffect(() => {
    if (isPublicShare) { setChecked(true); return; }
    api
      .me()
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/login');
      })
      .finally(() => setChecked(true));
  }, [navigate, isPublicShare]);

  const content = (() => {
    if (!checked) return <Loading />;
    if (isPublicShare) return <Outlet />;
    if (isLogin) return user ? <Navigate to="/" replace /> : <Outlet />;
    if (!user) return <Navigate to="/login" replace />;
    return (
      <div className="app">
        <Sidebar
          user={user}
          onLogout={async () => {
            await api.logout().catch(() => {});
            setUser(null);
            navigate('/login');
          }}
        />
        <motion.main
          className="app__main"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        >
          <Outlet context={{ user }} />
        </motion.main>
      </div>
    );
  })();

  return (
    <MotionConfig reducedMotion="user">
      <AuthContext.Provider value={auth}>
        <AnimatePresence mode="wait">{content}</AnimatePresence>
        <div id="floating-notifications" className="floating-notifications" aria-live="assertive" aria-atomic="true" />
      </AuthContext.Provider>
    </MotionConfig>
  );
}
