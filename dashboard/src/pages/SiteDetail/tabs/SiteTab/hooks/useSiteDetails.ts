import { useState } from 'react';
import { api } from '../../../../../api';

// Name and URL are one form with one Save. Each draft stays null until the
// field is touched, so the inputs keep showing the saved value as it changes
// underneath them and Save only sends what the operator actually edited.
export function useSiteDetails(
  id: number,
  saved: { name: string; url: string },
  onSaved: () => void,
) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Kept here rather than raised to the page. The page treats an error as
  // "this site could not be loaded" and renders it INSTEAD of the site, so a
  // rejected name would blank the screen and throw away what was typed.
  const [error, setError] = useState<string | null>(null);

  const name = nameDraft ?? saved.name;
  const url = urlDraft ?? saved.url;
  const nameChanged = name.trim() !== saved.name;
  const urlChanged = url.trim() !== saved.url;
  const dirty = nameChanged || urlChanged;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateSiteDetails(id, {
        ...(nameChanged ? { name: name.trim() } : {}),
        ...(urlChanged ? { url: url.trim() } : {}),
      });
      // Drop the drafts so the inputs fall back to the refetched values.
      setNameDraft(null);
      setUrlDraft(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the site details.');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setNameDraft(null);
    setUrlDraft(null);
    setError(null);
  }

  // Editing after a rejection clears it: the message described the value that
  // was sent, and that value is no longer what is in the box.
  function editName(value: string) {
    setNameDraft(value);
    setError(null);
  }
  function editUrl(value: string) {
    setUrlDraft(value);
    setError(null);
  }

  return { name, url, editName, editUrl, dirty, saving, save, reset, error };
}
