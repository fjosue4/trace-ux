import { useCallback, useEffect, useState } from 'react';
import { AnnouncementAppearance, api, FeedbackTrigger, Log, SiteDetail as SiteDetailData, SiteSettings, SurveyQuestion } from '../../../api';
import { SiteTab, WidgetSettingsModalKind } from '../SiteDetail.types';

export function useSiteDetail(id: number) {
  const [detail, setDetail] = useState<SiteDetailData | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [latestLogs, setLatestLogs] = useState<Log[]>([]);
  const [activeTab, setActiveTab] = useState<SiteTab>('overview');
  const [widgetSettingsModal, setWidgetSettingsModal] = useState<WidgetSettingsModalKind>(null);

  // Mirrors buildWidgetConfig on the server: with only one section switched on
  // the launcher names it rather than showing a generic label.
  const launcherPlaceholder = (() => {
    const on = [
      draft?.updates_enabled && "What's new",
      draft?.tickets_enabled && 'Support',
      draft?.feedback_enabled && 'Feedback',
    ].filter(Boolean) as string[];
    return on.length === 1 ? on[0] : 'Help & updates';
  })();

  // Re-read the site without touching `draft`. Anything that saves something
  // other than the settings — an icon, the URL, the recording switch — has to
  // use this: re-seeding the draft from the server would silently throw away
  // whatever unsaved widget styling the operator is in the middle of.
  const refreshDetail = useCallback(() => {
    api
      .getSiteDetail(id)
      .then((d) => {
        setDetail(d);
      })
      .catch(() => setError('Could not load this site.'));
  }, [id]);

  const load = useCallback(() => {
    api
      .getSiteDetail(id)
      .then((d) => {
        setDetail(d);
        setDraft(d.site.settings ?? null);
      })
      .catch(() => setError('Could not load this site.'));
    api.listLogs({ siteId: id, limit: 5 }).then(setLatestLogs).catch(() => setLatestLogs([]));
  }, [id]);

  useEffect(() => {
    if (id > 0) load();
  }, [id, load]);

  useEffect(() => {
    setActiveTab('overview');
    setWidgetSettingsModal(null);
  }, [id]);

  async function toggleRecording(enabled: boolean) {
    try {
      await api.updateSiteRecording(id, enabled);
      refreshDetail();
    } catch {
      setError('Could not change the recording setting.');
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    setSaved(false);
    try {
      const normalized: SiteSettings = {
        ...draft,
        questions: draft.questions?.map((q, i) => ({ ...q, id: q.id || `q${i + 1}` })),
      };
      await api.updateSiteSettings(id, normalized);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the configuration.');
    } finally {
      setSaving(false);
    }
  }

  function patchDraft(patch: Partial<SiteSettings>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function patchQuestion(i: number, patch: Partial<SurveyQuestion>) {
    setDraft((d) => {
      if (!d) return d;
      const questions = (d.questions ?? []).map((q, qi) => (qi === i ? { ...q, ...patch } : q));
      return { ...d, questions };
    });
  }

  function patchAnnouncementAppearance(patch: Partial<AnnouncementAppearance>) {
    setDraft((d) => (d ? { ...d, updates_appearance: { ...d.updates_appearance, ...patch } } : d));
  }

  function patchWidgetPosition(position: string) {
    patchDraft({ widget_position: position, updates_position: position, feedback_position: position });
  }

  function patchTrigger(patch: Partial<FeedbackTrigger>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            feedback_trigger: {
              mode: 'always',
              ...(d.feedback_trigger ?? {}),
              ...patch,
            } as FeedbackTrigger,
          }
        : d,
    );
  }

  return {
    detail,
    error,
    setError,
    draft,
    saving,
    saved,
    latestLogs,
    activeTab,
    setActiveTab,
    widgetSettingsModal,
    setWidgetSettingsModal,
    launcherPlaceholder,
    refreshDetail,
    load,
    toggleRecording,
    saveSettings,
    patchDraft,
    patchQuestion,
    patchAnnouncementAppearance,
    patchWidgetPosition,
    patchTrigger,
  };
}
