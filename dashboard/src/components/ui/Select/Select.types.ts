export type SelectOption = { value: string; label: string };

type SelectBaseProps = {
  options: SelectOption[];
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  emptyLabel?: string;
};

export type SelectProps =
  | (SelectBaseProps & {
      multiple?: false;
      value: string;
      onChange: (value: string) => void;
    })
  | (SelectBaseProps & {
      multiple: true;
      value: string[];
      onChange: (value: string[]) => void;
    });

export type SelectValue = string | string[];

export type SelectHookProps = {
  value: SelectValue;
  options: SelectOption[];
  onChange: (value: SelectValue) => void;
  multiple?: boolean;
  disabled?: boolean;
};

export type MenuPos = { top: number; left: number; minWidth: number };
