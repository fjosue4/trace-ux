export type SelectOption = { value: string; label: string };

export type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
};

export type MenuPos = { top: number; left: number; minWidth: number };
