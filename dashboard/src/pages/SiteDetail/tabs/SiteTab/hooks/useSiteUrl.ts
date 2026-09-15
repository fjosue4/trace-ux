import { useState } from 'react';
import { api } from '../../../../../api';

export function useSiteUrl(id: number, onSaved: () => void, onError: (message: string) => void) {
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [urlSaving, setUrlSaving] = useState(false);

  async function saveURL() {
    if (urlDraft === null) return;
    setUrlSaving(true);
    try {
      await api.updateSiteURL(id, urlDraft.trim());
      setUrlDraft(null);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update the site URL.');
    } finally {
      setUrlSaving(false);
    }
  }

  return { urlDraft, setUrlDraft, urlSaving, saveURL };
}
