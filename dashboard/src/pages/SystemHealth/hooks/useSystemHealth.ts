import { useCallback, useEffect, useState } from 'react';
import { api, SystemHealth as Health } from '../../../api';

export function useSystemHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState(0);

  const load = useCallback(() => {
    api
      .getSystemHealth()
      .then((h) => {
        setHealth(h);
        setStamp(Date.now() / 1000);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load system health.'));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  return { health, error, stamp };
}
