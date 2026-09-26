import { useCallback, useEffect, useState } from 'react';
import { api, SearchIndexStatus } from '../../../api';

function needsPolling(status: SearchIndexStatus): boolean {
  return (
    status.state === 'building' ||
    status.state === 'dropping' ||
    (status.enabled && status.state === 'off') ||
    (!status.enabled && status.state === 'ready')
  );
}

export function useSearchIndex() {
  const [status, setStatus] = useState<SearchIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);

  const restartPolling = useCallback(() => setPollGeneration((value) => value + 1), []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let retryPollingOnError = false;

    async function poll() {
      controller = new AbortController();
      try {
        const next = await api.getSearchIndex(controller.signal);
        if (stopped) return;
        setStatus(next);
        setError('');
        setLoading(false);
        retryPollingOnError = needsPolling(next);
        if (retryPollingOnError) timer = setTimeout(poll, 2500);
      } catch (cause) {
        if (stopped || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the search index status.');
        setLoading(false);
        if (retryPollingOnError) timer = setTimeout(poll, 2500);
      }
    }

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [pollGeneration]);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      const next = await api.updateSearchIndex(enabled);
      setStatus(next);
      setConfirmingOff(false);
      restartPolling();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the search index.');
    } finally {
      setBusy(false);
    }
  }

  function toggle(enabled: boolean) {
    if (enabled) void setEnabled(true);
    else setConfirmingOff(true);
  }

  return {
    status,
    loading,
    busy,
    error,
    confirmingOff,
    setConfirmingOff,
    toggle,
    disable: () => setEnabled(false),
    retry: () => setEnabled(status?.enabled ?? true),
  };
}
