import type { ReactNode } from 'react';
import Card from '../Card';
import './FilterPanel.scss';

type FilterPanelProps = {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  afterControls?: ReactNode;
  footer?: ReactNode;
  className?: string;
  controlsClassName?: string;
};

export default function FilterPanel({
  title,
  children,
  actions,
  afterControls,
  footer,
  className = '',
  controlsClassName = '',
}: FilterPanelProps) {
  return (
    <Card className={`filter-panel card--static ${className}`.trim()}>
      <div className="filter-panel__head">
        <strong>{title}</strong>
        {actions}
      </div>
      <div className={`filter-panel__controls ${controlsClassName}`.trim()}>{children}</div>
      {afterControls}
      {footer && <div className="filter-panel__foot">{footer}</div>}
    </Card>
  );
}
