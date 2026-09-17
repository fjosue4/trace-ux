import { LogSeverity } from '../../../../api';
import Switch from '../../../../components/ui/Switch';
import { Field, Input, Select } from '../../../../components/ui/fields';
import { LogsTabProps } from './LogsTab.types';

const severityOptions: { value: LogSeverity; label: string }[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

function legacySeverities(minimum?: LogSeverity): LogSeverity[] {
  const index = severityOptions.findIndex((option) => option.value === minimum);
  return severityOptions.slice(index >= 0 ? index : severityOptions.length - 1).map((option) => option.value);
}

export function LogsTab({ draft, onPatchDraft }: LogsTabProps) {
  const selectedSeverities = Array.isArray(draft.logs.severities)
    ? severityOptions
        .map((option) => option.value)
        .filter((severity) => draft.logs.severities?.includes(severity))
    : legacySeverities(draft.logs.minimum_severity);

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
        <Field label="Severity levels" hint="Select the individual levels you want to store.">
          <Select
            multiple
            value={selectedSeverities}
            onChange={(value) => {
              const severities = severityOptions
                .map((option) => option.value)
                .filter((severity) => value.includes(severity));
              onPatchDraft({
                logs: {
                  ...draft.logs,
                  severities,
                  minimum_severity: severities[0] ?? 'error',
                },
              });
            }}
            emptyLabel="No levels selected"
            options={severityOptions}
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
