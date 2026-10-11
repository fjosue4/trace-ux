import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTheme } from '../../../../hooks/useTheme';
import { Icon } from '../../../ui/Icon';
import './ThemeToggle.scss';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const reduceMotion = useReducedMotion();
  const label = `Switch to ${dark ? 'light' : 'dark'} theme`;
  return (
    <div className="sidebar__theme-control">
      <span className="sidebar__theme-label">Theme</span>
      <motion.button
        type="button"
        className={`theme-toggle theme-toggle--${theme}`}
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-pressed={dark}
      >
        <span className="theme-toggle__option theme-toggle__option--sun" aria-hidden="true">
          <Icon name="sun" size={14} />
        </span>
        <span className="theme-toggle__option theme-toggle__option--moon" aria-hidden="true">
          <Icon name="moon" size={14} />
        </span>
        <motion.span
          className="theme-toggle__thumb"
          initial={false}
          animate={{ x: dark ? 32 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              className="theme-toggle__thumb-icon"
              initial={{ opacity: 0, scale: 0.55, rotate: dark ? -35 : 35 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.55, rotate: dark ? 35 : -35 }}
              transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeInOut' }}
            >
              <Icon name={dark ? 'moon' : 'sun'} size={14} />
            </motion.span>
          </AnimatePresence>
        </motion.span>
      </motion.button>
    </div>
  );
}
