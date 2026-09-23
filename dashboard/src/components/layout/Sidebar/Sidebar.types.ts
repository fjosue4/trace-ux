import { CurrentUser } from '../../../api';
import type { IconName } from '../../ui/Icon';

export type SidebarNavItem = {
  to: string;
  label: string;
  icon: IconName;
};

export type SidebarProps = {
  user: CurrentUser;
  onLogout: () => void;
};
