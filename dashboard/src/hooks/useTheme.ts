import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'trace_ux_theme';
const listeners = new Set<() => void>();

function initialTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setTheme(next: Theme | ((current: Theme) => Theme)) {
  const theme = typeof next === 'function' ? next(initialTheme()) : next;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage blocked — session-only theme */
  }
  listeners.forEach((listener) => listener());
}

function toggle() {
  setTheme((theme) => theme === 'dark' ? 'light' : 'dark');
}

// Read the shared document theme so Settings and the sidebar always agree.
// The pre-paint script initializes it; updates notify every mounted consumer.
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, initialTheme);
  return { theme, setTheme, toggle };
}
