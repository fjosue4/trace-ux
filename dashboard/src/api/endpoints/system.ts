import { request } from '../client';
import { SystemHealth } from '../types/system';

export const systemEndpoints = {
  // Server health (admin only).
  getSystemHealth: () => request<SystemHealth>('/api/system/health'),
};
