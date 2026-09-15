import type { HTMLMotionProps } from 'motion/react';

export type ButtonProps = HTMLMotionProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
  size?: 'md' | 'sm';
  block?: boolean;
};
