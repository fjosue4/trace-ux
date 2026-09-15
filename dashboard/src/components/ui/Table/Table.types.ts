import type { ReactNode } from 'react';

export type TableProps = {
  headers: ReactNode[];
  widths?: string[];
  fixed?: boolean;
  children: ReactNode;
  className?: string;
};
