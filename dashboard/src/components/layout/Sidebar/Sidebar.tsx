import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { spring, stagger } from '../../../lib/motion';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import Logo from '../../ui/Logo';
import { ThemeToggle } from './subcomponents/ThemeToggle';
import { NavItem } from './subcomponents/NavItem';
import { MobileNavMenu, pathMatches } from './subcomponents/MobileNavMenu';
import { SidebarNavItem, SidebarProps } from './Sidebar.types';
import './Sidebar.scss';

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const location = useLocation();
  const navItems: SidebarNavItem[] = [
    { to: '/sites', icon: 'globe', label: 'Sites' },
    { to: '/sessions', icon: 'film', label: 'Sessions' },
    { to: '/performance', icon: 'activity', label: 'Performance' },
    { to: '/analyze', icon: 'chart', label: 'Analyze' },
    { to: '/feedback', icon: 'message', label: 'Feedback' },
    { to: '/tickets', icon: 'lifebuoy', label: 'Tickets' },
    { to: '/announcements', icon: 'megaphone', label: 'Announcements' },
    { to: '/logs', icon: 'code', label: 'Logs' },
    ...(user.role === 'admin' ? [{ to: '/system-health', icon: 'bolt' as const, label: 'System health' }] : []),
    { to: '/settings', icon: 'settings', label: 'Settings' },
  ];
  const primaryMobileItems = navItems.slice(0, 4);
  const secondaryItems = navItems.slice(4);
  const activeSecondary = secondaryItems.find((item) => pathMatches(location.pathname, item.to));
  const mobileFeatured = activeSecondary ?? secondaryItems[0];
  const mobileMenuItems = secondaryItems.filter((item) => item.to !== mobileFeatured?.to);

  return (
    <motion.aside className="sidebar" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
      <motion.div whileHover={{ x: 2 }} transition={spring}>
        <NavLink to="/sites" className="sidebar__brand" aria-label="TraceUX home">
          <Logo className="sidebar__logo" />
        </NavLink>
      </motion.div>

      <motion.nav className="sidebar__nav sidebar__nav--desktop" variants={stagger} initial="hidden" animate="visible">
        {navItems.map((item) => <NavItem key={item.to} {...item} />)}
      </motion.nav>

      <nav className="sidebar__mobile-nav" aria-label="Primary navigation">
        {primaryMobileItems.map((item) => <NavItem key={item.to} {...item} />)}
        {mobileFeatured && <NavItem key={mobileFeatured.to} {...mobileFeatured} />}
        <MobileNavMenu items={mobileMenuItems} />
      </nav>

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
