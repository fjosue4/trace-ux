import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeUp } from '../../../lib/motion';

type RowProps = { label: string; value: ReactNode; mono?: boolean };

export function Row({ label, value, mono = true }: RowProps) {
  return (
    <motion.div className="health-row" variants={fadeUp} initial="hidden" animate="visible">
      <span className="muted small">{label}</span>
      <span className={`small${mono ? ' mono' : ''}`}>{value}</span>
    </motion.div>
  );
}
