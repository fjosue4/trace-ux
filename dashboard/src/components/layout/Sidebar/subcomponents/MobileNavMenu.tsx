import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { softSpring, spring } from '../../../../lib/motion';
import { Icon } from '../../../ui/Icon';
import { SidebarNavItem } from '../Sidebar.types';

export function MobileNavMenu({ items }: { items: SidebarNavItem[] }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="sidebar__mobile-more">
      <motion.button
        type="button"
        className={`sidebar__link sidebar__more-trigger${open ? ' is-open' : ''}`}
        aria-label="More navigation"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        whileTap={{ scale: 0.98 }}
        transition={spring}
      >
        <Icon name="more" size={18} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="sidebar__mobile-menu"
            role="menu"
            initial={{ opacity: 0, y: -5, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.985 }}
            transition={softSpring}
          >
            {items.map((item) => {
              const active = pathMatches(location.pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  role="menuitem"
                  className={`sidebar__mobile-menu-link${active ? ' is-active' : ''}`}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {active && <Icon name="check" size={14} />}
                </Link>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function pathMatches(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}
