import type { FeedbackTrigger } from '../../../api';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import { Field, Input, Select } from '../../ui/fields';
import { QuestionEditor } from './subcomponents/QuestionEditor';
import { FeedbackSettingsModalProps } from './FeedbackSettingsModal.types';
import '../widgetSettingsModals.scss';

export default function FeedbackSettingsModal({
  open,
  onClose,
  draft,
  trigger,
  onPatchDraft,
  onPatchTrigger,
  onPatchQuestion,
}: FeedbackSettingsModalProps) {
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
              <QuestionEditor
                key={question.id || index}
                question={question}
                index={index}
                onPatchQuestion={onPatchQuestion}
                onRemove={(i) => onPatchDraft({ questions: (draft.questions ?? []).filter((_, questionIndex) => questionIndex !== i) })}
              />
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
