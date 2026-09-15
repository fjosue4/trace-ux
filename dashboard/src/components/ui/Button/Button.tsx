import classNames from 'classnames';
import { motion } from 'motion/react';
import { spring } from '../../../lib/motion';
import { ButtonProps } from './Button.types';
import './Button.scss';

export default function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = classNames('btn', `btn--${variant}`, `btn--${size}`, { 'btn--block': block }, className);
  return (
    <motion.button
      type={type}
      className={cls}
      whileHover={rest.disabled ? undefined : { y: -2 }}
      whileTap={rest.disabled ? undefined : { scale: 0.97, y: 0 }}
      transition={spring}
      {...rest}
    />
  );
}
