import type { ReactNode } from 'react';

export type PageHeaderProps = {
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: ReactNode;
};
