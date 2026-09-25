import classNames from 'classnames';
import type { CSSProperties } from 'react';
import { DetailEmptyProps, DetailMetaProps, DetailPaneProps } from './DetailModal.types';
import './DetailModal.scss';

// The building blocks of a wide "details" modal: a strip of labelled facts
// across the top, then one or more panes of content underneath. Pass
// `className="detail-modal"` to Modal to get the matching width and scrolling.

export function DetailMeta({ items }: DetailMetaProps) {
  return (
    <dl className="detail-meta" style={{ '--detail-meta-cols': items.length } as CSSProperties}>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="detail-label">{item.label}</dt>
          <dd title={item.title}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailPane({ label, icon, count, actions, className, children }: DetailPaneProps) {
  return (
    <section className={classNames('detail-pane', className)}>
      <div className="detail-pane__head">
        <span className="detail-pane__title">
          {icon}
          <span className="detail-label">{label}</span>
          {count !== undefined && <span className="detail-count">{count}</span>}
        </span>
        {actions && <span className="detail-pane__actions">{actions}</span>}
      </div>
      {children}
    </section>
  );
}

export function DetailEmpty({ children }: DetailEmptyProps) {
  return <p className="detail-empty muted small">{children}</p>;
}
