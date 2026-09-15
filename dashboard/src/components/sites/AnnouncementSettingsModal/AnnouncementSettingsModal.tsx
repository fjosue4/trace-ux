import { Link } from 'react-router-dom';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import { AnnouncementSettingsModalProps } from './AnnouncementSettingsModal.types';
import '../widgetSettingsModals.scss';

export default function AnnouncementSettingsModal({ open, onClose }: AnnouncementSettingsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Announcement settings"
      className="widget-settings-modal widget-settings-modal--compact"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="widget-section-modal">
        <span className="widget-section-modal__icon"><Icon name="megaphone" size={18} /></span>
        <div>
          <h4>Announcement content</h4>
          <p>
            Publish and manage the announcements that appear in this section from the Announcements area. The widget styling stays in the Widget tab.
          </p>
          <Link to="/announcements" className="btn btn--secondary btn--sm" onClick={onClose}>
            <Icon name="megaphone" size={13} />
            Manage announcements
          </Link>
        </div>
      </div>
    </Modal>
  );
}
