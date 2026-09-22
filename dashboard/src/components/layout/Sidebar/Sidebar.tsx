import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { spring, stagger } from '../../../lib/motion';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import Logo from '../../ui/Logo';
import { ThemeToggle } from './subcomponents/ThemeToggle';
import { NavItem } from './subcomponents/NavItem';
import { SidebarProps } from './Sidebar.types';
import './Sidebar.scss';

export default function Sidebar({ user, onLogout }: SidebarProps) {
  return (
    <motion.aside className="sidebar" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
      <motion.div whileHover={{ x: 2 }} transition={spring}>
        <NavLink to="/sites" className="sidebar__brand" aria-label="TraceUX home">
          <Logo className="sidebar__logo" />
        </NavLink>
      </motion.div>

      <motion.nav className="sidebar__nav" variants={stagger} initial="hidden" animate="visible">
        <NavItem to="/sites" icon="globe" label="Sites" />
        <NavItem to="/sessions" icon="film" label="Sessions" />
        <NavItem to="/performance" icon="activity" label="Performance" />
        <NavItem to="/feedback" icon="message" label="Feedback" />
        <NavItem to="/tickets" icon="lifebuoy" label="Tickets" />
        <NavItem to="/announcements" icon="megaphone" label="Announcements" />
        <NavItem to="/logs" icon="code" label="Logs" />
        {user.role === 'admin' && (
          <NavItem to="/system-health" icon="bolt" label="System health" />
        )}
        <NavItem to="/settings" icon="settings" label="Settings" />
      </motion.nav>

      <div className="sidebar__footer">
        {/* Above the theme toggle, so "which build is this?" is answerable
            without opening System health -- which is admin-only, and the
            person hitting a bad replay is often not an admin. */}
        {user.version && (
          <div className="sidebar__version mono" title={`TraceUX ${user.version}`}>
            {user.version}
          </div>
        )}
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
