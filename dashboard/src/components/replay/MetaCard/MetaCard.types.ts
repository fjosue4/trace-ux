import type { ReactNode } from 'react';
import { Session } from '../../../api';

export type MetaCardProps = {
  session: Session;
  /** Shown beside the identified user, e.g. a way to contact them. */
  userAction?: ReactNode;
};

export type MetaBlockProps = {
  label: string;
  wide?: boolean;
  children: ReactNode;
};
