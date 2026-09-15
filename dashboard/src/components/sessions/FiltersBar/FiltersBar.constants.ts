import { SelectOption } from '../../ui/fields';

export const DEVICE_OPTIONS: SelectOption[] = [
  { value: '', label: 'Any device' },
  ...['desktop', 'mobile', 'tablet'].map((d) => ({ value: d, label: d })),
];
export const BROWSER_OPTIONS: SelectOption[] = [
  { value: '', label: 'Any browser' },
  ...['Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', 'Bot', 'Other'].map((b) => ({ value: b, label: b })),
];
export const OS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Any OS' },
  ...['macOS', 'Windows', 'iOS', 'Android', 'Linux', 'ChromeOS'].map((o) => ({ value: o, label: o })),
];
export const LENGTH_OPTIONS: SelectOption[] = [
  { value: '0', label: 'Any length' },
  { value: '30000', label: '30s+' },
  { value: '120000', label: '2m+' },
  { value: '600000', label: '10m+' },
];
