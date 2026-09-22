import DebouncedTextInput from '../../../components/ui/DebouncedTextInput';
import { Icon } from '../../../components/ui/Icon';
import { Select } from '../../../components/ui/fields';
import { SearchScope } from '../Logs.types';

type LogSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
};

export function LogSearchField({ value, onChange, scope, onScopeChange }: LogSearchFieldProps) {
  return (
    <div className="logs-search" role="group" aria-label="Search logs">
      <Icon name="search" size={16} />
      <DebouncedTextInput
        className="field-control logs-search__input"
        type="search"
        value={value}
        onDebouncedChange={onChange}
        delayMs={320}
        placeholder="Search log content"
        aria-label="Search log content"
        autoComplete="off"
      />
      <Select
        className="logs-search__scope"
        ariaLabel="Search in"
        value={scope}
        onChange={(next) => onScopeChange(next as SearchScope)}
        options={[
          { value: 'both', label: 'All' },
          { value: 'message', label: 'Message only' },
          { value: 'extra', label: 'Extra only' },
        ]}
      />
    </div>
  );
}
