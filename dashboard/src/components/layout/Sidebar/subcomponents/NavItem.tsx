import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { fadeUp, spring } from '../../../../lib/motion';
import { Icon } from '../../../ui/Icon';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `sidebar__link${isActive ? ' is-active' : ''}`;

type NavItemProps = { to: string; label: string; icon: Parameters<typeof Icon>[0]['name']; end?: boolean };

export function NavItem({ to, label, icon, end = false }: NavItemProps) {
  return (
    <motion.div variants={fadeUp} whileHover={{ x: 3 }} whileTap={{ scale: 0.98 }} transition={spring}>
      <NavLink to={to} end={end} className={navLink} title={label} aria-label={label}>
        <Icon name={icon} size={16} />
        {label}
      </NavLink>
    </motion.div>
  );
}
