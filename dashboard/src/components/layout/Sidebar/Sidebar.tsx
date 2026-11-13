import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import Logo from '../../ui/Logo';
import { Icon } from '../../ui/Icon';
import { ThemeToggle } from './subcomponents/ThemeToggle';
import { NavItem } from './subcomponents/NavItem';
import { MobileNavMenu, pathMatches } from './subcomponents/MobileNavMenu';
import { SidebarNavItem, SidebarProps } from './Sidebar.types';
import './Sidebar.scss';

type NavGroup = { label: string; items: SidebarNavItem[] };

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const location = useLocation();
  const isAdmin = user.role === 'admin';

  // Grouped by what you are doing: watching visitors, talking to them, or
  // configuring TraceUX itself.
  const groups: NavGroup[] = [
    {
      label: 'Observe',
      items: [
        { to: '/sessions', icon: 'film', label: 'Sessions' },
        { to: '/performance', icon: 'activity', label: 'Performance' },
        { to: '/logs', icon: 'code', label: 'Logs' },
        { to: '/analyze', icon: 'chart', label: 'Analyze' },
      ],
    },
    {
      label: 'Engage',
      items: [
        { to: '/feedback', icon: 'message', label: 'Feedback' },
        { to: '/tickets', icon: 'lifebuoy', label: 'Tickets' },
        { to: '/announcements', icon: 'megaphone', label: 'Announcements' },
      ],
    },
    {
      label: 'Configure',
      items: [
        { to: '/sites', icon: 'globe', label: 'Sites' },
        ...(isAdmin ? [{ to: '/system-health', icon: 'bolt' as const, label: 'System health' }] : []),
        { to: '/settings', icon: 'settings', label: 'Settings' },
      ],
    },
  ];

  // The mobile strip keeps its own order: the four most-used pages first.
  const navItems: SidebarNavItem[] = [
    { to: '/sites', icon: 'globe', label: 'Sites' },
    { to: '/sessions', icon: 'film', label: 'Sessions' },
    { to: '/performance', icon: 'activity', label: 'Performance' },
    { to: '/analyze', icon: 'chart', label: 'Analyze' },
    { to: '/feedback', icon: 'message', label: 'Feedback' },
    { to: '/tickets', icon: 'lifebuoy', label: 'Tickets' },
    { to: '/announcements', icon: 'megaphone', label: 'Announcements' },
    { to: '/logs', icon: 'code', label: 'Logs' },
    ...(isAdmin ? [{ to: '/system-health', icon: 'bolt' as const, label: 'System health' }] : []),
    { to: '/settings', icon: 'settings', label: 'Settings' },
  ];
  const primaryMobileItems = navItems.slice(0, 4);
  const secondaryItems = navItems.slice(4);
  const activeSecondary = secondaryItems.find((item) => pathMatches(location.pathname, item.to));
  const mobileFeatured = activeSecondary ?? secondaryItems[0];
  const mobileMenuItems = secondaryItems.filter((item) => item.to !== mobileFeatured?.to);

  return (
    <motion.aside className="sidebar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
      <NavLink to="/sites" className="sidebar__brand" aria-label="TraceUX home">
        <Logo className="sidebar__logo" />
      </NavLink>

      <nav className="sidebar__nav sidebar__nav--desktop" aria-label="Primary navigation">
        {groups.map((group) => (
          <div key={group.label} className="sidebar__group">
            <span className="sidebar__group-label">{group.label}</span>
            {group.items.map((item) => <NavItem key={item.to} {...item} />)}
          </div>
        ))}
      </nav>

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
          <div className="sidebar__user-text">
            <span className="sidebar__user-name mono">{user.username}</span>
            <span className="sidebar__user-role">{user.role === 'admin' ? 'Administrator' : user.role.charAt(0).toUpperCase() + user.role.slice(1)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onLogout} aria-label="Log out" title="Log out">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>
    </motion.aside>
  );
}
