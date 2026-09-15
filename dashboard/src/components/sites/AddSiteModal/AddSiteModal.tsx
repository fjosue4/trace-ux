import { motion } from 'motion/react';
import { softSpring } from '../../../lib/motion';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import Notice from '../../ui/Notice';
import { Field, Input } from '../../ui/fields';
import SnippetCard from '../SnippetCard';
import { useAddSiteModal } from './hooks/useAddSiteModal';
import { AddSiteModalProps } from './AddSiteModal.types';
import './AddSiteModal.scss';

// The add-site flow owns its form and post-create state so the Sites page only
// needs to open the modal and refresh its list after a successful creation.
export default function AddSiteModal({ open, origin, onClose, onCreated, onConfigureSite }: AddSiteModalProps) {
  const { name, setName, url, setUrl, site, error, saving, create } = useAddSiteModal(open, onCreated);

  return (
    <Modal
      open={open}
      title={site ? 'Site is ready' : 'Add a site'}
      onClose={onClose}
      footer={
        !site ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" form="add-site-form" disabled={saving || !name.trim() || !url.trim()}>
              {saving ? 'Creating…' : 'Create site'}
            </Button>
          </>
        ) : undefined
      }
    >
      {site ? (
        <SnippetCard
          site={site}
          origin={origin}
          embedded
          onConfigureSite={() => onConfigureSite(site)}
          onDismiss={onClose}
        />
      ) : (
        <motion.form
          id="add-site-form"
          className="add-site-form"
          onSubmit={create}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={softSpring}
        >
          <p className="muted small">
            Add the site where you’ll install the TraceUX snippet. Recordings are only accepted
            from that origin.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Site name">
            <Input
              placeholder="Acme Shop"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Website URL">
            <Input
              placeholder="https://your-site.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              inputMode="url"
            />
          </Field>
          <span className="add-site-form__hint">
            Use the exact origin where the snippet will run, including the protocol.
          </span>
        </motion.form>
      )}
    </Modal>
  );
}
