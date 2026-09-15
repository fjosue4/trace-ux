import classNames from 'classnames';
import { HTMLMotionProps, motion } from 'motion/react';
import { spring } from '../../../lib/motion';
import './Input.scss';

export function Input({ className = '', ...props }: HTMLMotionProps<'input'>) {
  return (
    <motion.input
      className={classNames('field-control', className)}
      whileFocus={{ scale: 1.006 }}
      transition={spring}
      {...props}
    />
  );
}
