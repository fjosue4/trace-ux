import { useEffect, useState } from 'react';
import { api, PerformanceKey, SiteDetail as SiteDetailData } from '../../../../../api';

export function useSitePerformanceKeys(id: number, detail: SiteDetailData | null, onError: (message: string) => void) {
  const [performanceKeys, setPerformanceKeys] = useState<PerformanceKey[]>([]);
  const [newPerformanceKey, setNewPerformanceKey] = useState<{ id: number; value: string; hint: string } | null>(null);
  const [performanceKeySaving, setPerformanceKeySaving] = useState(false);
  const [performanceKeyCopied, setPerformanceKeyCopied] = useState(false);
  const [performanceExampleCopied, setPerformanceExampleCopied] = useState(false);

  useEffect(() => {
    setPerformanceKeys(detail?.performance_keys ?? []);
  }, [detail]);

  useEffect(() => {
    setNewPerformanceKey(null);
    setPerformanceKeyCopied(false);
    setPerformanceExampleCopied(false);
  }, [id]);

  async function createPerformanceKey() {
    setPerformanceKeySaving(true);
    try {
      const result = await api.createPerformanceKey(id);
      setNewPerformanceKey({ id: result.key_id, value: result.performance_key, hint: result.key_hint });
      setPerformanceKeys((keys) => [
        { id: result.key_id, key_hint: result.key_hint, created_at: result.created_at, last_used_at: 0 },
        ...keys,
      ]);
      setPerformanceKeyCopied(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create a performance key.');
    } finally {
      setPerformanceKeySaving(false);
    }
  }

  async function copyPerformanceKey() {
    if (!newPerformanceKey) return;
    try {
      await navigator.clipboard.writeText(newPerformanceKey.value);
      setPerformanceKeyCopied(true);
      setTimeout(() => setPerformanceKeyCopied(false), 1800);
    } catch {
      onError('Could not copy the performance key.');
    }
  }

  async function copyPerformanceExample(example: string) {
    try {
      await navigator.clipboard.writeText(example);
      setPerformanceExampleCopied(true);
      setTimeout(() => setPerformanceExampleCopied(false), 1800);
    } catch {
      onError('Could not copy the connection example.');
    }
  }

  async function removePerformanceKey(key: PerformanceKey) {
    if (!window.confirm(`Remove performance key ${key.key_hint}? Any backend using it will stop sending data.`)) return;
    try {
      await api.deletePerformanceKey(id, key.id);
      setPerformanceKeys((keys) => keys.filter((item) => item.id !== key.id));
      if (newPerformanceKey?.id === key.id) setNewPerformanceKey(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove the performance key.');
    }
  }

  return {
    performanceKeys,
    newPerformanceKey,
    performanceKeySaving,
    performanceKeyCopied,
    performanceExampleCopied,
    createPerformanceKey,
    copyPerformanceKey,
    copyPerformanceExample,
    removePerformanceKey,
  };
}
