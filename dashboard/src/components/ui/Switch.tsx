import { motion } from 'motion/react';
import { spring } from '../../lib/motion';
import './Switch.css';

type Props = {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
};

export default function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <motion.label className={`switch${disabled ? ' is-disabled' : ''}`} whileTap={disabled ? undefined : { scale: 0.98 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <motion.span
        className="switch__track"
        aria-hidden
        animate={{ backgroundColor: checked ? 'var(--accent)' : 'var(--line-strong)' }}
        transition={{ duration: 0.18 }}
      >
        <motion.span className="switch__knob" animate={{ x: checked ? 16 : 0 }} transition={spring} />
      </motion.span>
      {label && <span className="switch__label">{label}</span>}
    </motion.label>
  );
}
