import { ReactNode } from 'react';

export type IconName =
  | 'globe'
  | 'trash'
  | 'plus'
  | 'copy'
  | 'check'
  | 'play'
  | 'pause'
  | 'maximize'
  | 'minimize'
  | 'clock'
  | 'code'
  | 'x'
  | 'warn'
  | 'bolt'
  | 'sun'
  | 'moon'
  | 'film'
  | 'settings'
  | 'users'
  | 'star'
  | 'message'
  | 'send'
  | 'activity';

// Hand-drawn 24px stroke icon set (Feather-style) so the app ships zero icon
// dependencies and every icon inherits the current color.
const GLYPHS: Record<IconName, ReactNode> = {
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
      <path d="m19 6-1 13.5a2 2 0 0 1-2 1.5H8a2 2 0 0 1-2-1.5L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  play: (
    <path
      d="m11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"
      fill="currentColor"
      stroke="none"
    />
  ),
  pause: (
    <>
      <path d="M7 5v14" strokeWidth="3" />
      <path d="M17 5v14" strokeWidth="3" />
    </>
  ),
  maximize: <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />,
  minimize: <path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  warn: (
    <>
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  bolt: <path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10H12l1-8z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 8h9M17.5 8H20M4 16h3M11.5 16H20" />
      <circle cx="15" cy="8" r="2.2" />
      <circle cx="9" cy="16" r="2.2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 3.8a3.5 3.5 0 0 1 0 6.4" />
      <path d="M17.5 14.6a6.5 6.5 0 0 1 4 5.4" />
    </>
  ),
  star: (
    <path
      d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.8 6.2 20.8l1.1-6.4L2.6 9.8l6.5-.9L12 3z"
      fill="currentColor"
      stroke="none"
    />
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  send: <path d="m22 2-11 11M22 2 15 22l-4-9-9-4 20-7z" />,
  activity: <path d="M3 12h4l2.2-7 4.2 14 2.2-7H21" />,
};

type Props = { name: IconName; size?: number };

export function Icon({ name, size = 16 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={name === 'play' ? '0 0 16 16' : '0 0 24 24'}
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
