import { SiteSettings } from '../../../../api';

export type RecordingsTabProps = {
  draft: SiteSettings;
  onPatchDraft: (patch: Partial<SiteSettings>) => void;
};
