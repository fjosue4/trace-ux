import classNames from 'classnames';
import { motion } from 'motion/react';
import { softSpring } from '../../../lib/motion';
import { StatStripProps } from './StatStrip.types';
import './StatStrip.scss';

// One bordered row of key figures, divided by hairlines. Replaces a grid of
// separate stat cards: the numbers read as one summary, not four boxes.
export default function StatStrip({ items, className }: StatStripProps) {
  return (
    <motion.dl
      className={classNames('stat-strip', className)}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={softSpring}
    >
      {items.map((item) => (
        <div key={item.label} className={classNames('stat-strip__item', item.tone && `stat-strip__item--${item.tone}`)}>
          <dt className="stat-strip__label">{item.label}</dt>
          <dd className="stat-strip__value">{item.value}</dd>
          {item.detail && <dd className="stat-strip__detail">{item.detail}</dd>}
        </div>
      ))}
    </motion.dl>
  );
}
