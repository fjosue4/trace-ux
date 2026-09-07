import { HTMLMotionProps, motion } from 'motion/react';
import { softSpring } from '../../lib/motion';
import './Card.css';

type Props = HTMLMotionProps<'div'>;

export default function Card({ className = '', ...rest }: Props) {
  return (
    <motion.div
      className={`card ${className}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={softSpring}
      {...rest}
    />
  );
}
