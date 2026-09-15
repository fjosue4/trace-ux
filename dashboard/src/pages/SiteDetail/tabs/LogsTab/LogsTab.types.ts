import { SiteSettings } from '../../../../api';

export type LogsTabProps = {
  draft: SiteSettings;
  onPatchDraft: (patch: Partial<SiteSettings>) => void;
};
