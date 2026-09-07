import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { spring } from '../../lib/motion';
import './Badge.css';

type Props = {
  tone?: 'accent' | 'neutral' | 'danger';
  children: ReactNode;
};

export default function Badge({ tone = 'neutral', children }: Props) {
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
