import { Site } from '../../../api';

export type SnippetCardProps = {
  site: Site;
  origin: string;
  title?: string;
  onDismiss?: () => void;
  embedded?: boolean;
  onConfigureSite?: () => void;
};

export type InstallMethod = 'manual' | 'gtm';
