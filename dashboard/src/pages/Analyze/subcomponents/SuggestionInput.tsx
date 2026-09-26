import { KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import classNames from 'classnames';
import { Input } from '../../../components/ui/fields';

type SuggestionInputProps<T> = {
  value: string;
  onChange: (value: string) => void;
  onPick: (option: T) => void;
  /** Loads suggestions for the typed text; called debounced. */
  load: (search: string) => Promise<T[]>;
  /** Changing this discards cached suggestions (e.g. a different site). */
  scopeKey: string;
  optionKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  placeholder?: string;
  ariaLabel: string;
  invalid?: boolean;
  multiline?: boolean;
};

const SEARCH_DELAY_MS = 250;

/** A free-text field with a searchable list of values seen recently. Picking
 *  a suggestion copies its exact value; the report never references the row. */
export function SuggestionInput<T>({
  value,
  onChange,
  onPick,
  load,
  scopeKey,
  optionKey,
  renderOption,
  placeholder,
  ariaLabel,
  invalid,
  multiline,
}: SuggestionInputProps<T>) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const loadRef = useRef(load);
  loadRef.current = load;

  // Rows loaded for another scope (a different site) must never be shown,
  // even for the moment before the new ones arrive.
  useEffect(() => {
    setOptions([]);
    setActiveIndex(-1);
  }, [scopeKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      loadRef.current(value)
        .then((rows) => { if (!cancelled) { setOptions(rows); setFailed(false); setActiveIndex(-1); } })
        .catch(() => { if (!cancelled) { setOptions([]); setFailed(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, SEARCH_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, value, scopeKey]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function pick(option: T) {
    onPick(option);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (event.key === 'Enter' && open && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      pick(options[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const comboProps = {
    role: 'combobox',
    'aria-label': ariaLabel,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant': open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined,
    'aria-invalid': invalid || undefined,
    value,
    placeholder,
    onFocus: () => setOpen(true),
    onKeyDown,
    autoComplete: 'off',
    spellCheck: false,
  };

  return (
    <div ref={wrapRef} className="analyze-suggest">
      {multiline ? (
        <textarea
          {...comboProps}
          className="field-control analyze-suggest__textarea"
          rows={3}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        />
      ) : (
        <Input {...comboProps} onChange={(e) => { onChange(e.target.value); setOpen(true); }} />
      )}
      {open && (
        <ul id={listId} role="listbox" aria-label={`${ariaLabel} suggestions`} className="analyze-suggest__list">
          {options.map((option, index) => (
            <li
              key={optionKey(option)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={classNames('analyze-suggest__option', { 'is-active': index === activeIndex })}
              // pointerdown, not click: picking must win over the input's blur.
              onPointerDown={(event) => { event.preventDefault(); pick(option); }}
              onPointerEnter={() => setActiveIndex(index)}
            >
              {renderOption(option)}
            </li>
          ))}
          {!loading && options.length === 0 && (
            <li className="analyze-suggest__empty" role="presentation">
              {failed ? 'Suggestions are unavailable right now. You can still type an exact value.' : 'Nothing matching was seen in the last 30 days. You can still type an exact value.'}
            </li>
          )}
          {loading && options.length === 0 && <li className="analyze-suggest__empty" role="presentation">Searching…</li>}
        </ul>
      )}
    </div>
  );
}
