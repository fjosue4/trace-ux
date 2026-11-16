import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { Icon } from '../../../ui/Icon';
import { SidebarNavItem } from '../Sidebar.types';
import { NavBadge } from './NavBadge';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `sidebar__link${isActive ? ' is-active' : ''}`;

type NavItemProps = SidebarNavItem & { end?: boolean };

export function NavItem({ to, label, icon, badge, end = false }: NavItemProps) {
  // The count is part of the link's name, so it is announced, not just seen.
  const name = badge && badge.count > 0 ? `${label}, ${badge.label}` : label;
  return (
    <motion.div whileHover={{ x: 1 }} transition={{ type: 'tween', duration: 0.12, ease: 'easeOut' }}>
      <NavLink to={to} end={end} className={navLink} title={name} aria-label={name}>
        <Icon name={icon} size={16} />
        {label}
        <NavBadge badge={badge} />
      </NavLink>
    </motion.div>
  );
}
