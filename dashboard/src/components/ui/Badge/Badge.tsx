import { motion } from 'motion/react';
import { spring } from '../../../lib/motion';
import { BadgeProps } from './Badge.types';
import './Badge.scss';

export default function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <motion.span
      className={`badge badge--${tone}`}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.04 }}
      transition={spring}
    >
      {children}
    </motion.span>
  );
}
