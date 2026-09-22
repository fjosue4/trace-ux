export type SiteTab = 'overview' | 'site' | 'services' | 'recordings' | 'widget' | 'logs' | 'integrations';

export type WidgetSettingsModalKind = 'announcements' | 'feedback' | null;

export const siteTabs: {
  id: SiteTab;
  label: string;
  icon: 'activity' | 'settings' | 'film' | 'message' | 'megaphone' | 'code' | 'integrations';
}[] = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'site', label: 'Site', icon: 'settings' },
  { id: 'services', label: 'Services', icon: 'code' },
  { id: 'recordings', label: 'Recordings', icon: 'film' },
  { id: 'widget', label: 'Widget', icon: 'settings' },
  { id: 'logs', label: 'Logs', icon: 'code' },
  { id: 'integrations', label: 'Integrations', icon: 'integrations' },
];

export const announcementAccents = ['#2f7d4a', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2'];
