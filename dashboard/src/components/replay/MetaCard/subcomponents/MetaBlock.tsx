import { motion } from 'motion/react';
import { fadeUp } from '../../../../lib/motion';
import { MetaBlockProps } from '../MetaCard.types';

export function MetaBlock({ label, wide = false, children }: MetaBlockProps) {
  // Plain values (ids, user agents, UTM tags) truncate to one line with the
  // full text in the title. Composite values -- a link beside a copy button --
  // lay themselves out and are left alone.
  const text = typeof children === 'string' ? children : undefined;
  return (
    <motion.div className={`meta-block${wide ? ' meta-block--wide' : ''}`} variants={fadeUp} initial="hidden" animate="visible">
      <span className="meta-block__label">{label}</span>
      <span className={`meta-block__value${text ? ' meta-block__value--text' : ''}`} title={text}>{children}</span>
    </motion.div>
  );
}
