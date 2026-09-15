import { request } from '../client';
import { Role, User } from '../types/users';

export const usersEndpoints = {
  listUsers: () => request<User[]>('/api/users'),
  createUser: (username: string, password: string, role: Role) =>
    request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }),
  updateUser: (id: number, patch: { password?: string; role?: Role }) =>
    request<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
};
