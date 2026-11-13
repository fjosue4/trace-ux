import { Site } from '../../../api';

export type SiteRowProps = {
  site: Site;
  origin: string;
  /** In-progress sessions right now; undefined while loading or unavailable. */
  live?: number;
  index: number;
  canDelete: boolean;
  onDelete: (site: Site) => void;
};
