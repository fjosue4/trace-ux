import { motion } from 'motion/react';
import { fadeUp } from '../../../lib/motion';
import { NoticeProps } from './Notice.types';
import './Notice.scss';

export default function Notice({ tone = 'info', children }: NoticeProps) {
  return <motion.div className={`notice notice--${tone}`} variants={fadeUp} initial="hidden" animate="visible" exit="exit" role="status">{children}</motion.div>;
}
