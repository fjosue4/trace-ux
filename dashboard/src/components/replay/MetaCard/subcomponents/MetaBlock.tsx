import { motion } from 'motion/react';
import { fadeUp } from '../../../../lib/motion';
import { MetaBlockProps } from '../MetaCard.types';

export function MetaBlock({ label, wide = false, children }: MetaBlockProps) {
  return (
    <motion.div className={`meta-block${wide ? ' meta-block--wide' : ''}`} variants={fadeUp} initial="hidden" animate="visible">
      <span className="meta-block__label">{label}</span>
      <span className="meta-block__value">{children}</span>
    </motion.div>
  );
}
