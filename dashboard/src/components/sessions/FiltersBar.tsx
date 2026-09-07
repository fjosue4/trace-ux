import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { stagger } from '../../lib/motion';
import { SessionFilter } from '../../api';
import { Input, Select, SelectOption } from '../ui/fields';
import './FiltersBar.css';

type Props = {
  filter: SessionFilter;
  onChange: (patch: Partial<SessionFilter>) => void;
  /** Optional leading control (e.g. the site picker on the global page). */
  extra?: ReactNode;
};

const DEVICE_OPTIONS: SelectOption[] = [
  { value: '', label: 'Any device' },
  ...['desktop', 'mobile', 'tablet'].map((d) => ({ value: d, label: d })),
];
const BROWSER_OPTIONS: SelectOption[] = [
  { value: '', label: 'Any browser' },
  ...['Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', 'Bot', 'Other'].map((b) => ({ value: b, label: b })),
];
const OS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Any OS' },
  ...['macOS', 'Windows', 'iOS', 'Android', 'Linux', 'ChromeOS'].map((o) => ({ value: o, label: o })),
];
const LENGTH_OPTIONS: SelectOption[] = [
  { value: '0', label: 'Any length' },
  { value: '30000', label: '30s+' },
  { value: '120000', label: '2m+' },
  { value: '600000', label: '10m+' },
];

export default function FiltersBar({ filter, onChange, extra }: Props) {
  return (
    <motion.div className="filters" variants={stagger} initial="hidden" animate="visible">
      {extra}
      <Select
        ariaLabel="Device"
        value={filter.device || ''}
        options={DEVICE_OPTIONS}
        onChange={(v) => onChange({ device: v || undefined })}
      />

      <Select
        ariaLabel="Browser"
        value={filter.browser || ''}
        options={BROWSER_OPTIONS}
        onChange={(v) => onChange({ browser: v || undefined })}
      />

      <Select
        ariaLabel="Operating system"
        value={filter.os || ''}
        options={OS_OPTIONS}
        onChange={(v) => onChange({ os: v || undefined })}
      />

      <Select
        ariaLabel="Minimum length"
        value={String(filter.min_duration_ms || 0)}
        options={LENGTH_OPTIONS}
        onChange={(v) => onChange({ min_duration_ms: Number(v) || undefined })}
      />

      <Input
        placeholder="Filter by visitor id…"
        title="Matches the userId, clientId or remoteId attached to the session"
        value={filter.identity || ''}
        onChange={(e) => onChange({ identity: e.target.value || undefined })}
      />

      <Input
        placeholder="Filter by any visited path…"
        title="Matches the entry/exit URL and every page the session navigated through"
        value={filter.url || ''}
        onChange={(e) => onChange({ url: e.target.value || undefined })}
      />
    </motion.div>
  );
}
