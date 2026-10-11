import { GLYPHS } from './icons';
import { IconProps } from './Icon.types';

export function Icon({ name, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={name === 'integrations' || name === 'chart' ? '0 0 1024 1024' : '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[name]}
    </svg>
  );
}
