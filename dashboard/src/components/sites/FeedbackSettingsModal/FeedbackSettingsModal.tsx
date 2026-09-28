import { useEffect, useState } from 'react';
import { api, FeedbackCampaign, FeedbackCampaignInput } from '../../../api';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import Notice from '../../ui/Notice';
import Switch from '../../ui/Switch';
import { Field, Input, Select } from '../../ui/fields';
import { FeedbackSettingsModalProps } from './FeedbackSettingsModal.types';
import '../widgetSettingsModals.scss';

function blankCampaign(siteId: number): FeedbackCampaignInput {
  return {
    site_id: siteId,
    key: '',
    name: '',
    question: '',
    answer_type: 'sentiment',
    allow_comment: true,
    recurrence: 'every_occurrence',
    placement: 'explicit',
    enabled: true,
  };
}

export default function FeedbackSettingsModal({
  open,
  onClose,
  siteId,
  startCreating = false,
  initialCampaignId = null,
  onChanged,
}: FeedbackSettingsModalProps) {
  const [editing, setEditing] = useState<FeedbackCampaign | null>(null);
  const [draft, setDraft] = useState<FeedbackCampaignInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load(selectCampaignId?: number | null) {
    setLoading(true);
    setError('');
    api.listFeedbackCampaigns(siteId)
      .then((rows) => {
        const campaign = selectCampaignId
          ? rows.find((row) => row.id === selectCampaignId)
          : rows.find((row) => row.is_default) ?? rows[0];
        if (campaign) edit(campaign);
        else setError('This site does not have a feedback campaign yet.');
      })
      .catch(() => setError('Could not load feedback campaigns.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setError('');
    if (startCreating) {
      setLoading(false);
      setDraft(blankCampaign(siteId));
      return;
    }
    setDraft(null);
    load(initialCampaignId);
  }, [open, siteId, startCreating, initialCampaignId]);

  function edit(campaign: FeedbackCampaign) {
    setEditing(campaign);
    setDraft({
      site_id: campaign.site_id,
      key: campaign.key,
      name: campaign.name,
      question: campaign.question,
      answer_type: campaign.answer_type,
      allow_comment: campaign.allow_comment,
      recurrence: campaign.recurrence,
      placement: campaign.placement,
      enabled: campaign.enabled,
    });
    setError('');
  }

  function patch(values: Partial<FeedbackCampaignInput>) {
    setDraft((current) => current ? { ...current, ...values } : current);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      if (editing) await api.updateFeedbackCampaign(editing.id, draft);
      else await api.createFeedbackCampaign(draft);
      await onChanged?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the campaign.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : startCreating ? 'Add campaign' : 'Edit campaign'}
      className="widget-settings-modal"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || loading || !draft} onClick={() => void save()}>
            {saving ? 'Saving…' : editing ? 'Save campaign' : 'Add campaign'}
          </Button>
        </>
      )}
    >
      <p className="widget-settings-modal__intro">
        The default campaign is the Feedback section visitors can open themselves. Additional campaigns open from
        <code> traceux.feedback.expand('campaign-key')</code> after a product interaction.
      </p>
      {error && <Notice tone="error">{error}</Notice>}

      {draft ? (
        <div className="widget-settings-form campaign-editor">
          <div className="hub-config__grid widget-settings-fields">
            <Field label="Campaign name" hint="Only shown in the dashboard">
              <Input value={draft.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Campaign key" hint={editing ? 'Immutable after creation' : 'Used by the npm/global API'}>
              <Input
                value={draft.key}
                disabled={!!editing}
                maxLength={100}
                placeholder="phone-call-quality"
                onChange={(e) => patch({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })}
              />
            </Field>
          </div>
          <Field label="Campaign question">
            <Input value={draft.question} maxLength={300} onChange={(e) => patch({ question: e.target.value })} />
          </Field>
          <div className="hub-config__grid widget-settings-fields">
            <Field label="Answer type">
              <Select
                ariaLabel="Answer type"
                value={draft.answer_type}
                onChange={(answer_type) => patch({ answer_type: answer_type as FeedbackCampaignInput['answer_type'] })}
                options={[
                  { value: 'sentiment', label: 'Good / Bad' },
                  { value: 'stars', label: 'Stars (1–5)' },
                  { value: 'scale_10', label: 'Scale (1–10)' },
                ]}
              />
            </Field>
            <Field label="Recurrence" hint="Rolling cooldown starts when shown">
              <Select
                ariaLabel="Recurrence"
                value={draft.recurrence}
                onChange={(recurrence) => patch({ recurrence: recurrence as FeedbackCampaignInput['recurrence'] })}
                options={[
                  { value: 'every_occurrence', label: 'Every occurrence' },
                  { value: 'daily', label: 'After 24 hours' },
                  { value: 'weekly', label: 'After 7 days' },
                ]}
              />
            </Field>
          </div>
          <div className="campaign-editor__switches">
            <Switch checked={draft.allow_comment} onChange={(allow_comment) => patch({ allow_comment })} label="Show additional response field" />
            <Switch checked={draft.enabled} onChange={(enabled) => patch({ enabled })} label="Campaign enabled" />
          </div>
          {editing?.is_default && (
            <Notice tone="info">This is the site's basic feedback campaign. It can be edited or disabled, but not deleted.</Notice>
          )}
        </div>
      ) : (
        loading ? <p className="muted small">Loading campaign…</p> : null
      )}
    </Modal>
  );
}
