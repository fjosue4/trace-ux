import { useEffect, useMemo, useRef, useState } from 'react';
import { AnalyzeReport, AnalyzeResult, AnalyzeSource, api, ApiError, LogFilterOptions, Site } from '../../../api';
import {
  clearSourceFields,
  definitionFromForm,
  emptyForm,
  formFromReport,
  hasSourceFields,
  rangeForWindow,
  validateForm,
} from '../Analyze.helpers';
import { EditorForm } from '../Analyze.types';

const PREVIEW_DELAY_MS = 450;
const MATCH_FIELDS: (keyof EditorForm)[] = ['eventName', 'trackId', 'message'];

type PreviewState = { key: string; result: AnalyzeResult } | null;

/** Builder state for a new report (reportId null) or an existing one. */
export function useReportDefinition(reportId: number | null) {
  const [form, setForm] = useState<EditorForm>(emptyForm);
  const [original, setOriginal] = useState<AnalyzeReport | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'not-found' | 'read-only'>(reportId ? 'loading' : 'ready');
  const [sites, setSites] = useState<Site[]>([]);
  const [logOptions, setLogOptions] = useState<LogFilterOptions>({ services: [], environments: [] });
  const [pendingSource, setPendingSource] = useState<AnalyzeSource | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Fields the author has changed. An error is shown for a field only once
  // it has been edited (or a save was attempted), never on a blank form.
  const [edited, setEdited] = useState<ReadonlySet<keyof EditorForm>>(() => new Set());
  const [saveAttempted, setSaveAttempted] = useState(false);
  const previewSeq = useRef(0);

  useEffect(() => {
    api.listSites().then(setSites).catch(() => setSaveError('Could not load sites.'));
  }, []);

  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    api.getAnalyzeReport(reportId)
      .then((report) => {
        if (cancelled) return;
        setOriginal(report);
        setForm(formFromReport(report));
        setLoadState(report.can_edit ? 'ready' : 'read-only');
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setLoadState('not-found');
        else { setSaveError(e instanceof Error ? e.message : 'Could not load the report.'); setLoadState('ready'); }
      });
    return () => { cancelled = true; };
  }, [reportId]);

  // Service and environment choices follow the selected site.
  useEffect(() => {
    if (form.source !== 'log') return;
    let cancelled = false;
    api.logOptions(form.siteId).then((options) => {
      if (!cancelled) setLogOptions(options);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [form.source, form.siteId]);

  const errors = useMemo(() => validateForm(form), [form]);
  const valid = Object.keys(errors).length === 0;
  const definition = useMemo(() => definitionFromForm(form), [form]);
  const definitionKey = JSON.stringify(definition);
  // Only the definition decides whether the preview is current; renaming a
  // report does not make its numbers stale.
  const definitionValid = !errors.match && !errors.trackId && !errors.timezone && !errors.window;

  async function runPreview() {
    const seq = ++previewSeq.current;
    const key = definitionKey;
    setPreviewing(true);
    setPreviewError('');
    try {
      const result = await api.previewAnalyze(definition, rangeForWindow(form.window));
      if (seq === previewSeq.current) setPreview({ key, result });
    } catch (e) {
      if (seq === previewSeq.current) {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : 'Preview failed.');
      }
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }

  // Preview follows the definition as it is edited, after a short pause.
  useEffect(() => {
    if (loadState !== 'ready' || !definitionValid) return;
    if (preview?.key === definitionKey) return;
    const timer = window.setTimeout(runPreview, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [definitionKey, definitionValid, loadState]);

  const previewCurrent = preview !== null && preview.key === definitionKey;
  const canSave = valid && previewCurrent && !saving && !previewing && loadState === 'ready';

  function patch(update: Partial<EditorForm>) {
    setEdited((current) => new Set([...current, ...(Object.keys(update) as (keyof EditorForm)[])]));
    setForm((current) => ({ ...current, ...update }));
  }

  function showError(field: 'name' | 'match'): boolean {
    if (saveAttempted) return true;
    return field === 'name' ? edited.has('name') : MATCH_FIELDS.some((key) => edited.has(key));
  }

  function changeSite(siteId: number | null) {
    // A service belongs to one site; keeping it after switching sites would
    // make the definition invalid, so it is cleared with the switch.
    patch({ siteId, serviceId: null, environment: '' });
  }

  function requestSource(source: AnalyzeSource) {
    if (source === form.source) return;
    if (hasSourceFields(form)) {
      setPendingSource(source);
      return;
    }
    patch({ source });
  }

  function confirmSource() {
    if (!pendingSource) return;
    // The new source starts clean: its rule fields have not been edited yet.
    setEdited((current) => new Set([...current].filter((key) => !MATCH_FIELDS.includes(key))));
    setForm((current) => ({ ...clearSourceFields(current), source: pendingSource }));
    setPendingSource(null);
  }

  async function save(): Promise<AnalyzeReport | null> {
    setSaveAttempted(true);
    if (!canSave) return null;
    setSaving(true);
    setSaveError('');
    const input = {
      name: form.name.trim(),
      description: form.description.trim(),
      visibility: form.visibility,
      definition,
    };
    try {
      return original ? await api.updateAnalyzeReport(original.id, input) : await api.createAnalyzeReport(input);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the report.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  const services = logOptions.services.filter((s) => form.siteId === null || s.site_id === form.siteId);
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));

  return {
    form,
    patch,
    changeSite,
    original,
    loadState,
    sites,
    siteNames,
    services,
    environments: logOptions.environments,
    errors,
    showError,
    pendingSource,
    requestSource,
    confirmSource,
    cancelSource: () => setPendingSource(null),
    definition,
    definitionValid,
    preview: preview?.result ?? null,
    previewCurrent,
    previewing,
    previewError,
    runPreview,
    canSave,
    saving,
    saveError,
    save,
  };
}
