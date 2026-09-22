import { request } from '../client';
import { LogSeverity } from '../types/logs';
import { Service, ServiceKeyResponse } from '../types/services';

export const servicesEndpoints = {
  listServices: (siteId: number) => request<Service[]>(`/api/sites/${siteId}/services`),
  createService: (siteId: number, name: string) =>
    request<ServiceKeyResponse>(`/api/sites/${siteId}/services`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateService: (
    siteId: number,
    serviceId: number,
    update: { name: string; inherit_severities: boolean; severities: LogSeverity[] },
  ) =>
    request<Service>(`/api/sites/${siteId}/services/${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  rotateServiceKey: (siteId: number, serviceId: number) =>
    request<ServiceKeyResponse>(`/api/sites/${siteId}/services/${serviceId}/rotate-key`, {
      method: 'POST',
    }),
  revokeServiceKey: (siteId: number, serviceId: number) =>
    request<{ ok: boolean }>(`/api/sites/${siteId}/services/${serviceId}/key`, {
      method: 'DELETE',
    }),
};
