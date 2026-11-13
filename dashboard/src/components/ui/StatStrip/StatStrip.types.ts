import type { ReactNode } from 'react';

export type StatStripItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** Colours the value: 'live' (green), 'warn' (amber) or 'danger' (red). */
  tone?: 'live' | 'warn' | 'danger';
};

export type StatStripProps = {
  items: StatStripItem[];
  className?: string;
};
