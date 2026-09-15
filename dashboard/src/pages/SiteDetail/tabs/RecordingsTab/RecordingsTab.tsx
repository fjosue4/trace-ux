import Switch from '../../../../components/ui/Switch';
import { Field, Input } from '../../../../components/ui/fields';
import { RecordingsTabProps } from './RecordingsTab.types';

export function RecordingsTab({ draft, onPatchDraft }: RecordingsTabProps) {
  return (
    <>
      <div className="hub-config__title">Recordings</div>
      <div className="hub-config__grid">
        <Field label="Max simultaneous recordings" hint="0 = no limit">
          <Input
            type="number"
            min={0}
            max={100000}
            value={draft.max_concurrent_sessions ?? 0}
            onChange={(e) => onPatchDraft({ max_concurrent_sessions: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Keep recordings for (days)" hint="0 = server default">
          <Input
            type="number"
            min={0}
            max={3650}
            value={draft.retention_sessions_days ?? 0}
            onChange={(e) => onPatchDraft({ retention_sessions_days: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Keep feedback for (days)" hint="0 = server default">
          <Input
            type="number"
            min={0}
            max={3650}
            value={draft.retention_feedback_days ?? 0}
            onChange={(e) => onPatchDraft({ retention_feedback_days: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
      <div className="hub-config__row">
        <Switch
          checked={draft.allow_delete_recordings ?? true}
          onChange={(v) => onPatchDraft({ allow_delete_recordings: v })}
          label="Allow deleting recordings manually"
        />
      </div>
    </>
  );
}
