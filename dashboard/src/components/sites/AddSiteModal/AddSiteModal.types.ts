import { Site } from '../../../api';

export type AddSiteModalProps = {
  open: boolean;
  origin: string;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  onConfigureSite: (site: Site) => void;
};
