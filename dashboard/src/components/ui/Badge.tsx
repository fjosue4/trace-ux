import { ReactNode } from 'react';
import './Badge.css';

type Props = {
  tone?: 'accent' | 'neutral' | 'danger';
  children: ReactNode;
};

export default function Badge({ tone = 'neutral', children }: Props) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
