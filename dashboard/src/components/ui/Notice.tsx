import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeUp } from '../../lib/motion';
import './Notice.css';

type Props = {
  tone?: 'success' | 'error' | 'info';
  children: ReactNode;
};

export default function Notice({ tone = 'info', children }: Props) {
  return <motion.div className={`notice notice--${tone}`} variants={fadeUp} initial="hidden" animate="visible" exit="exit" role="status">{children}</motion.div>;
}
