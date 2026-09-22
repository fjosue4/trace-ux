import { LogSeverity } from './logs';

export type Service = {
  id: number;
  site_id: number;
  name: string;
  key_hint: string;
  inherit_severities: boolean;
  severities: LogSeverity[];
  created_at: number;
  last_used_at: number;
  revoked_at: number;
};

export type ServiceKeyResponse = {
  service: Service;
  api_key: string;
};
