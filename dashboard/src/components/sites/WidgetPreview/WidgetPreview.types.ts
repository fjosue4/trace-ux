import type { SiteSettings } from '../../../api';

export type WidgetPreviewProps = {
  draft: SiteSettings;
  iconUrl?: string;
  launcherPlaceholder: string;
};

export type PreviewSection = 'updates' | 'tickets' | 'feedback';
