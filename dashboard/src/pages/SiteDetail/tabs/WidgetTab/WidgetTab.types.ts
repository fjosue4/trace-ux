import { AnnouncementAppearance, SiteDetail as SiteDetailData, SiteSettings } from '../../../../api';
import { WidgetSettingsModalKind } from '../../SiteDetail.types';

export type WidgetTabProps = {
  id: number;
  draft: SiteSettings;
  detail: SiteDetailData;
  launcherPlaceholder: string;
  widgetSettingsModal: WidgetSettingsModalKind;
  onOpenWidgetSettingsModal: (modal: WidgetSettingsModalKind) => void;
  onPatchDraft: (patch: Partial<SiteSettings>) => void;
  onPatchAnnouncementAppearance: (patch: Partial<AnnouncementAppearance>) => void;
  onPatchWidgetPosition: (position: string) => void;
  onDetailChanged: () => void;
};
