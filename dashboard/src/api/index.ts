// Typed helpers around the dashboard API. All calls are same-origin.

export { ApiError } from './client';

export * from './types/sites';
export * from './types/sessions';
export * from './types/logs';
export * from './types/performance';
export * from './types/feedback';
export * from './types/announcements';
export * from './types/tickets';
export * from './types/system';
export * from './types/users';

import { authEndpoints } from './endpoints/auth';
import { usersEndpoints } from './endpoints/users';
import { sitesEndpoints } from './endpoints/sites';
import { sessionsEndpoints } from './endpoints/sessions';
import { logsEndpoints } from './endpoints/logs';
import { performanceEndpoints } from './endpoints/performance';
import { feedbackEndpoints } from './endpoints/feedback';
import { announcementsEndpoints } from './endpoints/announcements';
import { ticketsEndpoints } from './endpoints/tickets';
import { systemEndpoints } from './endpoints/system';

export const api = {
  ...authEndpoints,
  ...usersEndpoints,
  ...sitesEndpoints,
  ...sessionsEndpoints,
  ...logsEndpoints,
  ...performanceEndpoints,
  ...feedbackEndpoints,
  ...announcementsEndpoints,
  ...ticketsEndpoints,
  ...systemEndpoints,
};
