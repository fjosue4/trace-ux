import { useState } from 'react';
import Button from '../ui/Button';
import { Field, Input } from '../ui/fields';
import { SlackWebhookView } from '../../api';
import './WebhookField.scss';

export type WebhookDraft = { value: string; clear: boolean };

export const emptyWebhookDraft: WebhookDraft = { value: '', clear: false };

type WebhookFieldProps = {
  label: string;
  hint?: string;
  placeholder?: string;
  removedLabel?: string;
  view: SlackWebhookView;
  draft: WebhookDraft;
  onChange: (draft: WebhookDraft) => void;
};

// A saved webhook is never sent back to the browser -- only a masked hint.
// This field shows that hint with a "Replace" affordance instead of an input
// prefilled with anything sensitive, and staying blank on save means "keep
// the current secret" so flipping an unrelated switch can't wipe it.
export function WebhookField({ label, hint, placeholder, removedLabel = 'Webhook', view, draft, onChange }: WebhookFieldProps) {
  const [replacing, setReplacing] = useState(false);

  if (draft.clear) {
    return (
      <Field label={label} hint={hint}>
        <div className="webhook-field__row">
          <span className="muted small">{removedLabel} will be removed when you save.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ value: '', clear: false })}>
            Undo
          </Button>
        </div>
      </Field>
    );
  }

  if (view.configured && !replacing) {
    return (
      <Field label={label} hint={hint}>
        <div className="webhook-field__row">
          <span className="mono webhook-field__hint">{view.hint}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button type="button" variant="dangerGhost" size="sm" onClick={() => onChange({ value: '', clear: true })}>
            Remove
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint}>
      <div className="webhook-field__row">
        <Input
          placeholder={placeholder ?? 'https://hooks.slack.com/services/…'}
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value, clear: false })}
        />
        {view.configured && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </Field>
  );
}
