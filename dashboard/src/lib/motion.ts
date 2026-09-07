import type { Transition, Variants } from 'motion/react';

export const spring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};

export const softSpring: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 28,
  mass: 0.9,
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: softSpring },
  exit: { opacity: 0, y: -8, transition: { duration: 0.16 } },
};

export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.03 } },
};

