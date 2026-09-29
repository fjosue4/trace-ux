import { motion } from 'motion/react';
import { softSpring } from '../../../lib/motion';

type CoreMeterProps = { cores: number; coresUsed: number; hot?: boolean };

// One segment per CPU core, filled left to right with how many cores' worth of
// time TraceUX used. 1.7 cores on a 6-core box fills one segment and most of a
// second, instead of pinning a single bar at 170%.
export function CoreMeter({ cores, coresUsed, hot }: CoreMeterProps) {
  const count = Math.max(1, cores);
  return (
    <motion.div className="meter meter--cores" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {Array.from({ length: count }, (_, i) => {
        const fill = Math.max(0, Math.min(1, coresUsed - i)) * 100;
        return (
          <div key={i} className="meter__core">
            <motion.div
              className={`meter__fill meter__fill--shot${hot ? ' is-hot' : ''}`}
              initial={{ width: 0 }}
              animate={{ width: `${fill}%` }}
              transition={softSpring}
            />
          </div>
        );
      })}
    </motion.div>
  );
}
