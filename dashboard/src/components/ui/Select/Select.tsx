import { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import { AnimatePresence, motion } from 'motion/react';
import { softSpring, spring } from '../../../lib/motion';
import { useSelect } from './hooks/useSelect';
import { SelectProps } from './Select.types';
import './Select.scss';

export function Select({
  value,
  options,
  onChange,
  className = '',
  ariaLabel,
  disabled,
  emptyLabel = 'Select options',
}: SelectProps) {
  const multiple = Array.isArray(value);
  const selectedValues = multiple ? value : [value];
  const selectedOptions = options.filter((option) => selectedValues.includes(option.value));
  const selectedLabel = multiple
    ? selectedOptions.length > 0
      ? selectedOptions.map((option) => option.label).join(', ')
      : emptyLabel
    : selectedOptions[0]?.label ?? value;
  const handleChange = (next: string | string[]) => {
    if (multiple) {
      (onChange as (value: string[]) => void)(Array.isArray(next) ? next : [next]);
    } else {
      (onChange as (value: string) => void)(Array.isArray(next) ? next[0] ?? '' : next);
    }
  };

  const { open, active, pos, wrapRef, menuRef, toggleOpen, onKeyDown, onOptionHover, onOptionSelect } = useSelect({
    value,
    options,
    onChange: handleChange,
    multiple,
    disabled,
  });

  return (
    <span ref={wrapRef} className={classNames('select-wrap', { 'is-open': open }, className)}>
      <motion.button
        type="button"
        className="field-control select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={toggleOpen}
        onKeyDown={onKeyDown}
        whileTap={disabled ? undefined : { scale: 0.985 }}
        transition={spring}
      >
        <span className="select-trigger__label">{selectedLabel}</span>
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
                aria-multiselectable={multiple || undefined}
                ref={menuRef}
                style={pos as CSSProperties}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -3, scale: 0.985 }}
                transition={softSpring}
              >
                {options.map((option, index) => {
                  const isSelected = selectedValues.includes(option.value);
                  return (
                    <motion.button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-active={index === active || undefined}
                      className={classNames('select-menu__option', { 'is-selected': isSelected })}
                      onMouseEnter={() => onOptionHover(index)}
                      onClick={() => onOptionSelect(option)}
                      whileTap={{ scale: 0.98 }}
                    >
                      <span className="select-menu__label">{option.label}</span>
                      {isSelected && <CheckIcon />}
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}

function CheckIcon() {
  return (
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
}
