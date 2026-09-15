import { motion } from 'motion/react';
import { softSpring } from '../../../lib/motion';
import { CardProps } from './Card.types';
import './Card.scss';

export default function Card({ className = '', ...rest }: CardProps) {
  return (
    <motion.div
      className={`card ${className}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={softSpring}
      {...rest}
    />
  );
}
