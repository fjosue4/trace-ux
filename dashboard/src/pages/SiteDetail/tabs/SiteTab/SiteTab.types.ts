import { Site, SiteDetail as SiteDetailData } from '../../../../api';

export type SiteTabProps = {
  id: number;
  site: Site;
  detail: SiteDetailData;
  isAdmin: boolean;
  onDetailChanged: () => void;
  onError: (message: string) => void;
};
