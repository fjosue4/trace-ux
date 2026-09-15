import { useState } from 'react';
import { api } from '../../../../../api';

export function useWidgetIcon(id: number, onChanged: () => void) {
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

  async function uploadIcon(file: File) {
    setIconBusy(true);
    setIconError(null);
    try {
      await api.uploadWidgetIcon(id, file);
      onChanged();
    } catch (e) {
      setIconError(e instanceof Error ? e.message : 'Could not upload that image.');
    } finally {
      setIconBusy(false);
    }
  }

  async function removeIcon() {
    setIconBusy(true);
    setIconError(null);
    try {
      await api.deleteWidgetIcon(id);
      onChanged();
    } catch {
      setIconError('Could not remove the icon.');
    } finally {
      setIconBusy(false);
    }
  }

  return { iconBusy, iconError, uploadIcon, removeIcon };
}
