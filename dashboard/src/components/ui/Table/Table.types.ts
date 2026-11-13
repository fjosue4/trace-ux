import type { ReactNode } from 'react';

export type TableProps = {
  headers: ReactNode[];
  widths?: string[];
  /** Per-header classes, e.g. 'col-fit' or 'col-end', matching the body cells. */
  headerClassNames?: (string | undefined)[];
  fixed?: boolean;
  children: ReactNode;
  className?: string;
};
