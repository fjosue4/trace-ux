export type Role = 'admin' | 'viewer';

export type CurrentUser = {
  username: string;
  role: Role;
};

export type User = {
  id: number;
  username: string;
  role: Role;
  created_at: number;
};
