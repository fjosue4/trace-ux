import type { ReactNode } from 'react';

export type BadgeProps = {
  tone?: 'accent' | 'neutral' | 'danger' | 'info' | 'warn' | 'quiet';
  children: ReactNode;
};
