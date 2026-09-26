import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeUp } from '../../../lib/motion';

type RowProps = {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** Where a value too long for the row is cut. 'start' keeps the end in
   *  view, which is the informative part of a path. */
  truncate?: 'end' | 'start';
};

export function Row({ label, value, mono = true, truncate = 'end' }: RowProps) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  return (
    <motion.div className="health-row" variants={fadeUp} initial="hidden" animate="visible">
      <span className="muted small health-row__label">{label}</span>
      <span
        className={`small health-row__value${mono ? ' mono' : ''}${truncate === 'start' ? ' health-row__value--start' : ''}`}
        title={text}
      >
        {truncate === 'start' ? <bdi>{value}</bdi> : value}
      </span>
    </motion.div>
  );
}
