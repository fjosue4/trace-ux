import { ReactNode } from 'react';
import { Icon } from './Icon';
import './EmptyState.css';

type Props = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
};

export default function EmptyState({ title, description, action, icon }: Props) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>
        {icon ?? <Icon name="play" size={20} />}
      </div>
      <h3 className="empty__title">{title}</h3>
      {description && <p className="empty__desc">{description}</p>}
      {action}
    </div>
  );
}
