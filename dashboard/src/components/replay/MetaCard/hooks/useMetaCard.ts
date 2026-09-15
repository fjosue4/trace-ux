import { useEffect, useState } from 'react';

const COLLAPSE_KEY = 'trace_ux_replay_meta_collapsed';

export function useMetaCard() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage blocked; the choice just does not persist */
    }
  }, [collapsed]);

  return { collapsed, setCollapsed };
}
