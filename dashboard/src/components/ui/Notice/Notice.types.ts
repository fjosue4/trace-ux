import type { ReactNode } from 'react';

export type NoticeProps = {
  tone?: 'success' | 'error' | 'info';
  children: ReactNode;
};
