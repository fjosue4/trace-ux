import { User } from '../../../api';

export type UserRowProps = {
  user: User;
  currentUsername: string;
  onEvent: (message: string, tone: 'success' | 'error') => void;
  onChanged: () => void;
};
