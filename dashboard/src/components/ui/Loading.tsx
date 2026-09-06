import { ReactNode } from 'react';
import './Loading.css';

type Props = { label?: string; overlay?: boolean };

export default function Loading({ label = 'Loading…', overlay = false }: Props) {
  return (
    <div className={`loading${overlay ? ' loading--overlay' : ''}`}>
      <span className="loading__spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function InlineSpinner() {
  return <span className="loading__spinner loading__spinner--inline" aria-hidden />;
}

// Convenience for pages that render either content or a loading placeholder.
export function MaybeLoading({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Loading /> : <>{children}</>;
}
