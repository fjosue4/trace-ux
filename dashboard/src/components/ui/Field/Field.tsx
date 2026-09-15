import { motion } from 'motion/react';
import { softSpring } from '../../../lib/motion';
import { FieldProps } from './Field.types';
import './Field.scss';

export function Field({ label, hint, children }: FieldProps) {
  return (
    <motion.label className="field" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </motion.label>
  );
}
