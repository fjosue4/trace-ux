import { motion } from 'motion/react';
import { spring } from '../../../../lib/motion';
import { useTheme } from '../../../../hooks/useTheme';
import { Icon } from '../../../ui/Icon';

export function ThemeToggle() {
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
