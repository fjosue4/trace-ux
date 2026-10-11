import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { Icon } from '../../../ui/Icon';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `sidebar__link${isActive ? ' is-active' : ''}`;

type NavItemProps = { to: string; label: string; icon: Parameters<typeof Icon>[0]['name']; end?: boolean };

export function NavItem({ to, label, icon, end = false }: NavItemProps) {
  return (
    <motion.div whileHover={{ x: 1 }} transition={{ type: 'tween', duration: 0.12, ease: 'easeOut' }}>
      <NavLink to={to} end={end} className={navLink} title={label} aria-label={label}>
        <Icon name={icon} size={16} />
        {label}
      </NavLink>
    </motion.div>
  );
}
