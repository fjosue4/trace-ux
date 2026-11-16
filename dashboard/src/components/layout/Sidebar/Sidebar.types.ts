import { CurrentUser } from '../../../api';
import type { IconName } from '../../ui/Icon';

/** A count beside a navigation item, for work waiting there. */
export type SidebarNavBadge = {
  count: number;
  /** Someone is waiting on us: drawn in the attention colour. */
  attention: boolean;
  /** Spoken and shown on hover, e.g. "3 open, 1 needs a reply". */
  label: string;
};

export type SidebarNavItem = {
  to: string;
  label: string;
  icon: IconName;
  badge?: SidebarNavBadge;
};

export type SidebarProps = {
  user: CurrentUser;
  onLogout: () => void;
};
