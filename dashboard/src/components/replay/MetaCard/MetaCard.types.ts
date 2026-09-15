import type { ReactNode } from 'react';
import { Session } from '../../../api';

export type MetaCardProps = { session: Session };

export type MetaBlockProps = {
  label: string;
  wide?: boolean;
  children: ReactNode;
};
