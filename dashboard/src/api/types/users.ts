export type Role = 'admin' | 'viewer';

export type CurrentUser = {
  /** Optional: servers older than Analyze do not send it. */
  id?: number;
  username: string;
  role: Role;
  /** Build version of the server, e.g. "v0.2.9". Optional: a server older than
   *  this field simply does not send it, and the sidebar hides the line. */
  version?: string;
};

export type User = {
  id: number;
  username: string;
  role: Role;
  created_at: number;
};
