import { useEffect, useRef, useState } from 'react';
import { api, SessionExportStatus } from '../../../api';

type ExportOperation = { controller: AbortController; id?: string; ready?: boolean };

function cancelOperation(operation: ExportOperation) {
  operation.controller.abort();
  if (operation.id && !operation.ready) void api.cancelSessionExport(operation.id).catch(() => {});
}

function waitForProgress(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Export canceled', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1000);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function useSessionExport(sessionId?: string) {
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportStatus, setExportStatus] = useState<SessionExportStatus | null>(null);
  const pending = useRef<ExportOperation | null>(null);
  const downloadPending = useRef(false);
  const lastReady = useRef<string | null>(null);

  useEffect(() => {
    setExporting(false);
    setDownloading(false);
    downloadPending.current = false;
    lastReady.current = null;
    setExportError('');
    setExportStatus(null);
    return () => {
      if (pending.current) cancelOperation(pending.current);
      pending.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!downloading) return;
    // Browsers expose no save-dialog closed/download-complete event to web
    // pages. Keep the action locked through the native handoff, then release
    // it on the next real interaction in the focused page. A native modal
    // blocks those interactions until it is finished or canceled.
    const resume = (event: Event) => {
      if (!event.isTrusted || !document.hasFocus()) return;
      downloadPending.current = false;
      setDownloading(false);
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
    return () => {
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
    };
  }, [downloading]);

  function onDownloadStart() {
    downloadPending.current = true;
    setDownloading(true);
  }

  function dismissExport() {
    // Hide only the status UI. The browser may still be writing the file;
    // retain the prepared download until expiry or the next export.
    setExportStatus(null);
  }

  function cancelExport() {
    if (pending.current) cancelOperation(pending.current);
    pending.current = null;
    setExporting(false);
    setExportStatus(null);
  }

  async function exportSession() {
    if (!sessionId || pending.current || downloadPending.current) return;
    const operation: ExportOperation = { controller: new AbortController() };
    const { signal } = operation.controller;
    pending.current = operation;
    setExporting(true);
    setExportError('');
    setExportStatus(null);
    try {
      if (lastReady.current) {
        await api.cancelSessionExport(lastReady.current).catch(() => {});
        lastReady.current = null;
      }
      if (signal.aborted) return;
      // Let this short request return its job ID even if the user cancels in
      // the meantime, so we can cancel the server job instead of abandoning it.
      let status = await api.prepareSessionExport(sessionId);
      operation.id = status.id;
      if (signal.aborted) {
        cancelOperation(operation);
        return;
      }
      setExportStatus(status);
      while (status.state === 'preparing') {
        await waitForProgress(signal);
        status = await api.getSessionExport(status.id, signal);
        if (signal.aborted) return;
        setExportStatus(status);
      }
      if (status.state === 'failed') throw new Error(status.error || 'Could not prepare the export.');
      if (!status.download_url) throw new Error('The export download is unavailable.');
      lastReady.current = status.id;
      // Native attachment download: no giant JSON parse, event array or Blob
      // is built in the replay tab. The finished file stays available briefly
      // so the user can retry if their browser blocks the automatic download.
      const link = document.createElement('a');
      link.href = status.download_url;
      link.download = `traceux-session-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      document.body.appendChild(link);
      onDownloadStart();
      link.click();
      link.remove();
      operation.ready = true;
    } catch (e) {
      if (!signal.aborted) {
        downloadPending.current = false;
        setDownloading(false);
        setExportError(e instanceof Error ? e.message : 'Could not prepare the export.');
        setExportStatus(null);
        cancelOperation(operation);
      }
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        setExporting(false);
      }
    }
  }

  return { exporting, downloading, exportError, exportStatus, exportSession, cancelExport, dismissExport, onDownloadStart };
}
