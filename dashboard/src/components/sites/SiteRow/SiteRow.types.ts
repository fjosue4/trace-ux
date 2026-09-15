import { Site } from '../../../api';

export type SiteRowProps = {
  site: Site;
  origin: string;
  onDelete: (site: Site) => void;
};
