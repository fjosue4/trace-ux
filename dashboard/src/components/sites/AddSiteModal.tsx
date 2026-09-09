import { FormEvent, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api, Site } from '../../api';
import { softSpring } from '../../lib/motion';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Notice from '../ui/Notice';
import { Field, Input } from '../ui/fields';
import SnippetCard from './SnippetCard';
import './AddSiteModal.css';

type Props = {
  open: boolean;
  origin: string;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  onConfigureSite: (site: Site) => void;
};

// The add-site flow owns its form and post-create state so the Sites page only
// needs to open the modal and refresh its list after a successful creation.
export default function AddSiteModal({ open, origin, onClose, onCreated, onConfigureSite }: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setUrl('');
      setSite(null);
      setError('');
      setSaving(false);
    }
  }, [open]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      setError('Site name and website URL are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.createSite(name.trim(), url.trim());
      setSite(created);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create site.');
    } finally {
      setSaving(false);
    }
  }

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
