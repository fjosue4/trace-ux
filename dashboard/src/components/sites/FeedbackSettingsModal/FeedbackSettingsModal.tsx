import { useEffect, useState } from 'react';
import { api, FeedbackCampaign, FeedbackCampaignInput } from '../../../api';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import Notice from '../../ui/Notice';
import Switch from '../../ui/Switch';
import { Icon } from '../../ui/Icon';
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

export default function FeedbackSettingsModal({ open, onClose, siteId }: FeedbackSettingsModalProps) {
  const [campaigns, setCampaigns] = useState<FeedbackCampaign[]>([]);
  const [editing, setEditing] = useState<FeedbackCampaign | null>(null);
  const [draft, setDraft] = useState<FeedbackCampaignInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    api.listFeedbackCampaigns(siteId)
      .then(setCampaigns)
      .catch(() => setError('Could not load feedback campaigns.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setDraft(null);
    load();
  }, [open, siteId]);

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

  function create() {
    setEditing(null);
    setDraft(blankCampaign(siteId));
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
      setEditing(null);
      setDraft(null);
      load();
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
      title="Feedback campaigns"
      className="widget-settings-modal"
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      <p className="widget-settings-modal__intro">
        The default campaign is the Feedback section visitors can open themselves. Additional campaigns open from
        <code> traceux.feedback.expand('campaign-key')</code> after a product interaction.
      </p>
      {error && <Notice tone="error">{error}</Notice>}

      {draft ? (
        <div className="widget-settings-form campaign-editor">
          <div className="campaign-editor__head">
            <button type="button" className="icon-btn" aria-label="Back to campaigns" onClick={() => setDraft(null)}>
              <Icon name="chevronUp" size={15} />
            </button>
            <strong>{editing ? `Edit ${editing.name}` : 'New campaign'}</strong>
          </div>
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
          <div className="campaign-editor__actions">
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save campaign'}</Button>
          </div>
        </div>
      ) : (
        <div className="campaign-list">
          <div className="campaign-list__head">
            <div>
              <div className="widget-settings-modal__title">Campaigns</div>
              <span className="muted small">{campaigns.length} configured</span>
            </div>
            <Button size="sm" onClick={create}><Icon name="plus" size={13} /> New campaign</Button>
          </div>
          {loading ? (
            <p className="muted small">Loading campaigns…</p>
          ) : campaigns.map((campaign) => (
            <button type="button" className="campaign-row" key={campaign.id} onClick={() => edit(campaign)}>
              <span className="campaign-row__main">
                <span className="campaign-row__title">
                  {campaign.name}
                  {campaign.is_default && <span className="chip">Default</span>}
                  <span className={`campaign-row__state${campaign.enabled ? ' is-on' : ''}`}>{campaign.enabled ? 'Enabled' : 'Disabled'}</span>
                </span>
                <span className="campaign-row__question">{campaign.question}</span>
                <code>{campaign.key}</code>
              </span>
              <span className="campaign-row__stats">
                <strong>{campaign.response_count ?? 0}</strong> responses
                <small>{campaign.shown_count ?? 0} shown · {campaign.dismissed_count ?? 0} closed · {campaign.skipped_count ?? 0} skipped</small>
              </span>
              <Icon name="more" size={15} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
