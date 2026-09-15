import type { ReactNode } from 'react';

export type BadgeProps = {
  tone?: 'accent' | 'neutral' | 'danger';
  children: ReactNode;
};
