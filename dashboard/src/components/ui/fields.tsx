import {
  CSSProperties,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, HTMLMotionProps, motion } from 'motion/react';
import { softSpring, spring } from '../../lib/motion';
import './fields.css';

export function Input({ className = '', ...props }: HTMLMotionProps<'input'>) {
  return (
    <motion.input
      className={`field-control ${className}`.trim()}
      whileFocus={{ scale: 1.006 }}
      transition={spring}
      {...props}
    />
  );
}

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
};

type MenuPos = { top: number; left: number; minWidth: number };

// A document-positioned popover anchored to the trigger. It is rendered in a
// body portal so animated cards/tables cannot clip it, and it flips upward
// near the viewport edge.
function computeMenuPos(wrap: HTMLElement, optionCount: number): { pos: MenuPos; up: boolean } {
  const rect = wrap.getBoundingClientRect();
  const menuH = Math.min(optionCount * 36 + 12, 300);
  const up = window.innerHeight - rect.bottom < menuH + 12 && rect.top > menuH + 12;
  const scrollLeft = window.scrollX || window.pageXOffset;
  const scrollTop = window.scrollY || window.pageYOffset;
  const menuWidth = Math.max(rect.width, 240);
  const viewportLeft = scrollLeft + 8;
  const viewportRight = scrollLeft + window.innerWidth - menuWidth - 8;
  const left = Math.min(
    Math.max(rect.left + scrollLeft, viewportLeft),
    Math.max(viewportLeft, viewportRight),
  );
  const top = up
    ? rect.top + scrollTop - menuH - 6
    : rect.bottom + scrollTop + 6;
  const pos: MenuPos = { top, left, minWidth: rect.width };
  return { pos, up };
}

// Fully custom dropdown: a trigger button plus a styled listbox popover. No
// native popup is involved, so it looks identical on every OS and theme.
// Keyboard: Enter/Space/ArrowDown opens, arrows navigate, Enter selects,
// Escape/Tab/outside-click closes. Focus stays on the trigger.
export function Select({ value, options, onChange, className = '', ariaLabel, disabled }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Measure after the open state commits as well as in the click handler. The
  // second measurement covers production builds where the trigger can be
  // remounted by an animated form/card while the click is being committed.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    setPos(computeMenuPos(wrapRef.current, options.length).pos);
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const reposition = () => {
      if (wrapRef.current) setPos(computeMenuPos(wrapRef.current, options.length).pos);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, options.length]);

  // Keep the highlighted option visible while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function openMenu() {
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    if (wrapRef.current) setPos(computeMenuPos(wrapRef.current, options.length).pos);
    setOpen(true);
  }

  function commit(option?: SelectOption) {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(a + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(options[active]);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <span ref={wrapRef} className={`select-wrap${open ? ' is-open' : ''} ${className}`.trim()}>
      <motion.button
        type="button"
        className="field-control select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        whileTap={disabled ? undefined : { scale: 0.985 }}
        transition={spring}
      >
        <span className="select-trigger__label">{selected?.label ?? value}</span>
      </motion.button>
      <motion.svg
        className="select-wrap__chevron"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        animate={{ rotate: open ? 180 : 0 }}
        transition={spring}
      >
        <path d="m6 9 6 6 6-6" />
      </motion.svg>
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                className="select-menu"
                role="listbox"
                aria-label={ariaLabel}
                ref={menuRef}
                style={pos as CSSProperties}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -3, scale: 0.985 }}
                transition={softSpring}
              >
                {options.map((o, i) => (
                  <motion.button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    data-active={i === active || undefined}
                    className={`select-menu__option${o.value === value ? ' is-selected' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(o)}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="select-menu__label">{o.label}</span>
                    {o.value === value && <CheckIcon />}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

type FieldProps = { label: string; hint?: string; children: ReactNode };

export function Field({ label, hint, children }: FieldProps) {
  return (
    <motion.label className="field" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </motion.label>
  );
}
