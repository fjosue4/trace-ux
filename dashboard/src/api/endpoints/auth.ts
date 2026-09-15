import { request } from '../client';
import { CurrentUser } from '../types/users';

export const authEndpoints = {
  me: () => request<CurrentUser>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
};
