import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { CurrentUser } from '../../api';
import { fadeUp, spring, stagger } from '../../lib/motion';
import { useTheme } from '../../hooks/useTheme';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { Icon } from '../ui/Icon';
import Logo from '../ui/Logo';
import './Sidebar.css';

type Props = {
  user: CurrentUser;
  onLogout: () => void;
};

const navLink = ({ isActive }: { isActive: boolean }) =>
  `sidebar__link${isActive ? ' is-active' : ''}`;

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <motion.button
      className="sidebar__theme"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.97 }}
      transition={spring}
    >
      <Icon name={dark ? 'sun' : 'moon'} size={14} />
      <span>{dark ? 'Light mode' : 'Dark mode'}</span>
    </motion.button>
  );
}

function NavItem({ to, label, icon, end = false }: { to: string; label: string; icon: Parameters<typeof Icon>[0]['name']; end?: boolean }) {
  return (
    <motion.div variants={fadeUp} whileHover={{ x: 3 }} whileTap={{ scale: 0.98 }} transition={spring}>
      <NavLink to={to} end={end} className={navLink} title={label} aria-label={label}>
        <Icon name={icon} size={16} />
        {label}
      </NavLink>
    </motion.div>
  );
}

export default function Sidebar({ user, onLogout }: Props) {
  return (
    <motion.aside className="sidebar" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
      <motion.div whileHover={{ x: 2 }} transition={spring}>
        <NavLink to="/" className="sidebar__brand" aria-label="TraceUX home">
          <Logo className="sidebar__logo" />
        </NavLink>
      </motion.div>

      <motion.nav className="sidebar__nav" variants={stagger} initial="hidden" animate="visible">
        <NavItem to="/" end icon="globe" label="Sites" />
        <NavItem to="/sessions" icon="film" label="Sessions" />
        <NavItem to="/feedback" icon="message" label="Feedback" />
        <NavItem to="/logs" icon="code" label="Logs" />
        {user.role === 'admin' && (
          <NavItem to="/system-health" icon="bolt" label="System health" />
        )}
        <NavItem to="/settings" icon="settings" label="Settings" />
      </motion.nav>

      <div className="sidebar__footer">
        <ThemeToggle />
        <div className="sidebar__user">
          <span className="mono">{user.username}</span>
          <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role}</Badge>
        </div>
        <Button variant="secondary" size="sm" block onClick={onLogout}>
          Log out
        </Button>
      </div>
    </motion.aside>
  );
}
