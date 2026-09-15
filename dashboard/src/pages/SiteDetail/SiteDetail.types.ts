export type SiteTab = 'overview' | 'site' | 'recordings' | 'widget' | 'logs';

export type WidgetSettingsModalKind = 'announcements' | 'feedback' | null;

export const siteTabs: { id: SiteTab; label: string; icon: 'activity' | 'settings' | 'film' | 'message' | 'megaphone' | 'code' }[] = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'site', label: 'Site', icon: 'settings' },
  { id: 'recordings', label: 'Recordings', icon: 'film' },
  { id: 'widget', label: 'Widget', icon: 'settings' },
  { id: 'logs', label: 'Logs', icon: 'code' },
];

export const announcementAccents = ['#2f7d4a', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2'];
