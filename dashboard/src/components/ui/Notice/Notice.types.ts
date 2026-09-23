import type { ReactNode } from 'react';

export type NoticeProps = {
  tone?: 'success' | 'error' | 'info' | 'warn';
  /** Render the notice in the shared viewport-level notification stack. */
  floating?: boolean;
  children: ReactNode;
};
