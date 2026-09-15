import { Role } from '../../../api';

export type AddUserModalProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (username: string, password: string, role: Role) => Promise<void>;
};
