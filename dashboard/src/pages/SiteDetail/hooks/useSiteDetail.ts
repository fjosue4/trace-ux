import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnnouncementAppearance, api, FeedbackTrigger, FrequentError, SiteDetail as SiteDetailData, SiteSettings, SurveyQuestion } from '../../../api';
import { SiteTab, siteTabs, WidgetSettingsModalKind } from '../SiteDetail.types';

export function useSiteDetail(id: number) {
  const [detail, setDetail] = useState<SiteDetailData | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [frequentErrors, setFrequentErrors] = useState<FrequentError[]>([]);
  const [frequentErrorsFromMs, setFrequentErrorsFromMs] = useState(0);
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

  // Unsaved when the draft differs from what the server last returned. Keys
  // are sorted first because a patch can add a field in a different position
  // than the server serialises it, which must not count as a change.
  const dirty = useMemo(() => {
    if (!draft || !detail?.site.settings) return false;
    return stableJSON(draft) !== stableJSON(detail.site.settings);
  }, [draft, detail]);

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
    const fromMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    setFrequentErrorsFromMs(fromMs);
    api.frequentErrors({ siteId: id, fromMs, limit: 5 }).then(setFrequentErrors).catch(() => setFrequentErrors([]));
  }, [id]);

  useEffect(() => {
    if (id > 0) load();
  }, [id, load]);

  useEffect(() => {
    // `?tab=site` (used when skipping onboarding) opens that tab directly.
    const requested = new URLSearchParams(window.location.search).get('tab');
    setActiveTab(siteTabs.some((tab) => tab.id === requested) ? (requested as SiteTab) : 'overview');
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

  // Resolves true once the server has accepted the draft, so a caller such as
  // the onboarding wizard can move on only after a successful save.
  async function saveSettings(): Promise<boolean> {
    if (!draft) return false;
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the configuration.');
      return false;
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
    // updates_position and feedback_position are the pre-unification fields and
    // only ever understood 'left' | 'right'. Writing 'middle-left' into them
    // would corrupt config that older trackers still read as their side, so
    // they get the plain side and only widget_position carries the anchor.
    const side = position.endsWith('left') ? 'left' : 'right';
    patchDraft({ widget_position: position, updates_position: side, feedback_position: side });
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
    dirty,
    saving,
    saved,
    frequentErrors,
    frequentErrorsFromMs,
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

function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
