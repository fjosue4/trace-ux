import { Link } from 'react-router-dom';
import type { FeedbackTrigger, SiteSettings, SurveyQuestion } from '../../api';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { Field, Input, Select } from '../ui/fields';
import './WidgetSettingsModals.css';

type AnnouncementSettingsProps = {
  open: boolean;
  onClose: () => void;
};

export function AnnouncementSettingsModal({ open, onClose }: AnnouncementSettingsProps) {
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

type FeedbackSettingsProps = {
  open: boolean;
  onClose: () => void;
  draft: SiteSettings;
  trigger: FeedbackTrigger;
  onPatchDraft: (patch: Partial<SiteSettings>) => void;
  onPatchTrigger: (patch: Partial<FeedbackTrigger>) => void;
  onPatchQuestion: (index: number, patch: Partial<SurveyQuestion>) => void;
};

export function FeedbackSettingsModal({
  open,
  onClose,
  draft,
  trigger,
  onPatchDraft,
  onPatchTrigger,
  onPatchQuestion,
}: FeedbackSettingsProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Feedback settings"
      className="widget-settings-modal"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="widget-settings-modal__intro">
        Configure the survey shown in the Feedback section. Changes stay in the draft until you save the widget configuration.
      </p>
      <div className="widget-settings-form">
        <div className="widget-settings-modal__title">Survey</div>
        <div className="hub-config__grid">
          <Field label="Survey id" hint="Groups responses together">
            <Input value={draft.survey_id} onChange={(e) => onPatchDraft({ survey_id: e.target.value })} />
          </Field>
          <Field label="Survey title">
            <Input value={draft.survey_title} onChange={(e) => onPatchDraft({ survey_title: e.target.value })} />
          </Field>
          <Field label="Question set">
            <Select
              value={draft.survey_type}
              ariaLabel="Question set"
              onChange={(value) => onPatchDraft({ survey_type: value })}
              options={[
                { value: 'stars', label: 'Stars (1–5) + comment' },
                { value: 'nps', label: 'NPS (0–10) + comment' },
                { value: 'custom', label: 'Custom questions' },
              ]}
            />
          </Field>
          <Field label="Show section">
            <Select
              value={trigger.mode}
              ariaLabel="Show section"
              onChange={(value) => onPatchTrigger({ mode: value as FeedbackTrigger['mode'] })}
              options={[
                { value: 'always', label: 'Always' },
                { value: 'page', label: 'On specific pages' },
                { value: 'action', label: 'After a tracked action' },
              ]}
            />
          </Field>
        </div>

        {trigger.mode === 'page' && (
          <Field
            label="Page patterns"
            hint="Comma separated, * wildcards — e.g. /checkout*, /pricing. The feedback section appears only on matching pages."
          >
            <Input
              value={(trigger.pages ?? []).join(', ')}
              onChange={(e) => onPatchTrigger({ pages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
        )}
        {trigger.mode === 'action' && (
          <Field
            label="Tracked actions"
            hint="Comma separated trace-ux-track-id names — the widget opens on the feedback section when the visitor clicks one."
          >
            <Input
              value={(trigger.actions ?? []).join(', ')}
              onChange={(e) => onPatchTrigger({ actions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
        )}

        {draft.survey_type === 'custom' && (
          <div className="hub-questions">
            {(draft.questions ?? []).map((question, index) => (
              <div key={question.id || index} className="hub-question">
                <Input
                  placeholder="Question text"
                  aria-label={`Question ${index + 1} text`}
                  value={question.label}
                  onChange={(e) => onPatchQuestion(index, { label: e.target.value })}
                />
                <Select
                  value={question.type}
                  ariaLabel={`Question ${index + 1} type`}
                  onChange={(value) =>
                    onPatchQuestion(index, {
                      type: value as SurveyQuestion['type'],
                      max: value === 'rating' ? 5 : undefined,
                      options: value === 'choice' ? ['Yes', 'No'] : undefined,
                    })
                  }
                  options={[
                    { value: 'rating', label: 'Rating' },
                    { value: 'choice', label: 'Choice' },
                    { value: 'text', label: 'Text' },
                  ]}
                />
                {question.type === 'rating' && (
                  <Select
                    value={String(question.max || 5)}
                    ariaLabel={`Question ${index + 1} scale`}
                    onChange={(value) => onPatchQuestion(index, { max: Number(value) })}
                    options={[
                      { value: '5', label: '1–5 stars' },
                      { value: '10', label: '0–10 NPS' },
                    ]}
                  />
                )}
                {question.type === 'choice' && (
                  <Input
                    placeholder="Options, comma separated"
                    aria-label={`Question ${index + 1} options`}
                    value={(question.options ?? []).join(', ')}
                    onChange={(e) => onPatchQuestion(index, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  />
                )}
                <label className="hub-question__optional">
                  <input
                    type="checkbox"
                    checked={!!question.optional}
                    onChange={(e) => onPatchQuestion(index, { optional: e.target.checked })}
                  />
                  Optional
                </label>
                <button
                  className="icon-btn"
                  type="button"
                  title="Remove question"
                  aria-label={`Remove question ${index + 1}`}
                  onClick={() => onPatchDraft({ questions: (draft.questions ?? []).filter((_, questionIndex) => questionIndex !== index) })}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onPatchDraft({
                  questions: [
                    ...(draft.questions ?? []),
                    { id: `q${(draft.questions?.length ?? 0) + 1}`, label: '', type: 'rating', max: 5 },
                  ],
                })
              }
            >
              <Icon name="plus" size={13} />
              Add question
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
