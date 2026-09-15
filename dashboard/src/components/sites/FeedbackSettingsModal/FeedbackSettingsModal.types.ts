import type { FeedbackTrigger, SiteSettings, SurveyQuestion } from '../../../api';

export type FeedbackSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  draft: SiteSettings;
  trigger: FeedbackTrigger;
  onPatchDraft: (patch: Partial<SiteSettings>) => void;
  onPatchTrigger: (patch: Partial<FeedbackTrigger>) => void;
  onPatchQuestion: (index: number, patch: Partial<SurveyQuestion>) => void;
};
