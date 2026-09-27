export type FeedbackSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  siteId: number;
  startCreating?: boolean;
  initialCampaignId?: number | null;
  onChanged?: () => void | Promise<void>;
};
