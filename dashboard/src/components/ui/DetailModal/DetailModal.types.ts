import type { ReactNode } from 'react';

export type DetailMetaItem = {
  label: string;
  value: ReactNode;
  // Full text for a value the strip truncates, shown on hover.
  title?: string;
};

export type DetailMetaProps = {
  items: DetailMetaItem[];
};

export type DetailPaneProps = {
  label: string;
  icon?: ReactNode;
  count?: number;
  // Controls on the right of the pane heading: copy buttons, filters.
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

export type DetailEmptyProps = {
  children: ReactNode;
};
