import { SidebarNavBadge } from '../Sidebar.types';

/** The count beside a navigation item. Nothing at all when there is no work. */
export function NavBadge({ badge }: { badge?: SidebarNavBadge }) {
  if (!badge || badge.count <= 0) return null;
  return (
    <span className={`sidebar__badge${badge.attention ? ' is-attention' : ''}`} title={badge.label} aria-hidden="true">
      {badge.count > 99 ? '99+' : badge.count}
    </span>
  );
}
