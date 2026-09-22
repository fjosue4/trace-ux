import { motion } from 'motion/react';
import { stagger } from '../../../lib/motion';
import { formatCountry } from '../../../lib/format';
import DebouncedTextInput from '../../ui/DebouncedTextInput';
import { Select, SelectOption } from '../../ui/fields';
import FilterPanel from '../../ui/FilterPanel';
import { BROWSER_OPTIONS, DEVICE_OPTIONS, LENGTH_OPTIONS, OS_OPTIONS } from './FiltersBar.constants';
import { FiltersBarProps } from './FiltersBar.types';

export default function FiltersBar({ filter, onChange, extra, countries = [] }: FiltersBarProps) {
  const countryOptions: SelectOption[] = [
    { value: '', label: 'Any country' },
    ...countries.map((country) => ({ value: country, label: formatCountry(country) })),
  ];

  return (
    <motion.div variants={stagger} initial="hidden" animate="visible">
      <FilterPanel title="Filter sessions" controlsClassName="session-filters">
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
          ariaLabel="Country"
          value={filter.country || ''}
          options={countryOptions}
          onChange={(v) => onChange({ country: v || undefined })}
        />

        <Select
          ariaLabel="Minimum length"
          value={String(filter.min_duration_ms || 0)}
          options={LENGTH_OPTIONS}
          onChange={(v) => onChange({ min_duration_ms: Number(v) || undefined })}
        />

        <DebouncedTextInput
          className="field-control"
          placeholder="Filter by visitor id…"
          title="Matches the userId, clientId or remoteId attached to the session"
          value={filter.identity || ''}
          onDebouncedChange={(value) => onChange({ identity: value || undefined })}
        />

        <DebouncedTextInput
          className="field-control"
          placeholder="Filter by any visited path…"
          title="Matches the entry/exit URL and every page the session navigated through"
          value={filter.url || ''}
          onDebouncedChange={(value) => onChange({ url: value || undefined })}
        />

        <DebouncedTextInput
          className="field-control"
          placeholder="Filter by action…"
          title="Matches custom events, page visits, and browser logs recorded in the session"
          value={filter.action || ''}
          onDebouncedChange={(value) => onChange({ action: value || undefined })}
        />
      </FilterPanel>
    </motion.div>
  );
}
