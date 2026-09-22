import { Site } from '../../../../api';

export type SiteTabProps = {
  id: number;
  site: Site;
  isAdmin: boolean;
  onDetailChanged: () => void;
};
