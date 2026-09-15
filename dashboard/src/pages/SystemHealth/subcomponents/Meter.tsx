import { motion } from 'motion/react';
import { softSpring } from '../../../lib/motion';
import { clampPct } from '../SystemHealth.constants';

type MeterProps = { usedPct: number; shotPct?: number; hot?: boolean };

// Bar showing how much of the resource is in use; the leading accent segment
// is the part TraceUX itself accounts for.
export function Meter({ usedPct, shotPct, hot }: MeterProps) {
  const shot = Math.max(0, Math.min(shotPct ?? 0, usedPct));
  return (
    <motion.div className="meter" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {shot > 0 && <motion.div className="meter__fill meter__fill--shot" initial={{ width: 0 }} animate={{ width: `${clampPct(shot)}%` }} transition={softSpring} />}
      <motion.div className={`meter__fill${hot ? ' is-hot' : ''}`} initial={{ width: 0 }} animate={{ width: `${clampPct(usedPct - shot)}%` }} transition={softSpring} />
    </motion.div>
  );
}
