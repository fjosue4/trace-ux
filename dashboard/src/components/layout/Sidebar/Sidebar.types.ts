import { CurrentUser } from '../../../api';

export type SidebarProps = {
  user: CurrentUser;
  onLogout: () => void;
};
