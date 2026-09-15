import { LogSeverity } from '../../../../api';
import Switch from '../../../../components/ui/Switch';
import { Field, Input, Select } from '../../../../components/ui/fields';
import { LogsTabProps } from './LogsTab.types';

export function LogsTab({ draft, onPatchDraft }: LogsTabProps) {
  return (
    <>
      <div className="hub-config__title">Logs</div>
      <div className="hub-config__row">
        <Switch
          checked={draft.logs.enabled}
          onChange={(enabled) => onPatchDraft({ logs: { ...draft.logs, enabled } })}
          label="Capture browser logs"
        />
      </div>
      <div className="hub-config__grid">
        <Field
          label="Minimum severity"
          hint="Only this level and more severe logs are stored. Errors are the most severe."
        >
          <Select
            value={draft.logs.minimum_severity}
            onChange={(value) =>
              onPatchDraft({ logs: { ...draft.logs, minimum_severity: value as LogSeverity } })
            }
            options={[
              { value: 'error', label: 'Errors only' },
              { value: 'warn', label: 'Warnings and errors' },
              { value: 'info', label: 'Info and above' },
              { value: 'debug', label: 'All levels' },
            ]}
          />
        </Field>
        <Field label="Keep logs for (days)" hint="0 = no time limit · default 15 days">
          <Input
            type="number"
            min={0}
            max={3650}
            value={draft.logs.retention_days ?? 15}
            onChange={(e) =>
              onPatchDraft({
                logs: { ...draft.logs, retention_days: Number(e.target.value) || 0 },
              })
            }
          />
        </Field>
        <Field label="Maximum stored logs" hint="0 = no row limit · default 1,000,000">
          <Input
            type="number"
            min={0}
            max={10000000}
            step={1000}
            value={draft.logs.max_rows ?? 1000000}
            onChange={(e) =>
              onPatchDraft({
                logs: { ...draft.logs, max_rows: Number(e.target.value) || 0 },
              })
            }
          />
        </Field>
      </div>
      <p className="muted small">
        Logs are linked to recordings by session and are removed when the related recording is removed. The age and row caps are enforced during the server's retention sweep.
      </p>
    </>
  );
}
