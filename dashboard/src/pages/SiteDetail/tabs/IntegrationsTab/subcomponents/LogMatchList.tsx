import { LogSeverity, SlackLogMatch, SlackLogMatchMode } from '../../../../../api';
import Button from '../../../../../components/ui/Button';
import { Icon } from '../../../../../components/ui/Icon';
import { Input, Select } from '../../../../../components/ui/fields';

const severityOptions: { value: LogSeverity; label: string }[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

const modeOptions: { value: SlackLogMatchMode; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'exact', label: 'Exact match' },
];

/** Slack log alert rules. A log is sent when it matches any row: its severity
 *  is one of the row's levels (none = any) and the pattern matches (blank =
 *  any message). No rows sends every log that passes the site's settings. */
export function LogMatchList({
  rules,
  onChange,
}: {
  rules: SlackLogMatch[];
  onChange: (rules: SlackLogMatch[]) => void;
}) {
  const patch = (index: number, change: Partial<SlackLogMatch>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule)));

  return (
    <div className="log-matches">
      <div className="log-matches__head">
        <span className="field-label">Matches</span>
        <span className="muted small">
          {rules.length === 0
            ? "None yet: every log that passes the site's severity settings is sent."
            : 'A log is sent when it matches any of these.'}
        </span>
      </div>

      {rules.length > 0 && (
        <div className="log-matches__rows">
          {rules.map((rule, index) => (
            <div className="log-matches__row" key={index}>
              <Select
                ariaLabel={`Match ${index + 1} severities`}
                multiple
                value={rule.severities ?? []}
                onChange={(value) =>
                  patch(index, {
                    severities: severityOptions.map((option) => option.value).filter((severity) => value.includes(severity)),
                  })
                }
                emptyLabel="Any severity"
                options={severityOptions}
              />
              <Select
                ariaLabel={`Match ${index + 1} mode`}
                value={rule.mode}
                onChange={(value) => patch(index, { mode: value as SlackLogMatchMode })}
                options={modeOptions}
              />
              <Input
                aria-label={`Match ${index + 1} message pattern`}
                value={rule.value}
                onChange={(event) => patch(index, { value: event.target.value })}
                placeholder={rule.severities?.length ? 'Blank = every log at these levels' : 'e.g. TypeError'}
                maxLength={500}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="log-matches__remove"
                onClick={() => onChange(rules.filter((_, i) => i !== index))}
                aria-label={`Remove match ${index + 1}`}
                title="Remove match"
              >
                <Icon name="x" size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="log-matches__add"
        onClick={() => onChange([...rules, { mode: 'contains', value: '', severities: [] }])}
      >
        <Icon name="plus" size={13} /> Add match
      </Button>
    </div>
  );
}
