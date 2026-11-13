import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { softSpring } from '../../../lib/motion';
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

// A toolbar row of filter controls. The title names the group for screen
// readers; on screen the controls speak for themselves.
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
    <motion.section
      className={`filter-panel ${className}`.trim()}
      aria-label={title}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={softSpring}
    >
      <div className="filter-panel__row">
        <div className={`filter-panel__controls ${controlsClassName}`.trim()}>{children}</div>
        {actions && <div className="filter-panel__actions">{actions}</div>}
      </div>
      {afterControls}
      {footer && <div className="filter-panel__foot">{footer}</div>}
    </motion.section>
  );
}
