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


// Data transitions in charts: a decisive ease-out tween rather than a spring,
// so bars and lines settle on the new values without overshooting them --
// an overshoot would briefly show a count that is not real.
export const chartTween: Transition = {
  type: 'tween',
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1],
};
