import type { ReactNode } from 'react';
import { SessionFilter } from '../../../api';

export type FiltersBarProps = {
  filter: SessionFilter;
  onChange: (patch: Partial<SessionFilter>) => void;
  extra?: ReactNode;
  countries?: string[];
};
