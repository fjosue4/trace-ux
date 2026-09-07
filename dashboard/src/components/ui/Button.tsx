import { HTMLMotionProps, motion } from 'motion/react';
import { spring } from '../../lib/motion';
import './Button.css';

type Props = HTMLMotionProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
  size?: 'md' | 'sm';
  block?: boolean;
};

export default function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  type = 'button',
  ...rest
}: Props) {
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className]
    .filter(Boolean)
    .join(' ');
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
