import { useCallback, useEffect, useState } from 'react';
import { api, Feedback as FeedbackItem, FeedbackCampaign, FeedbackSummary, Site } from '../../../api';

type SiteSelection = number | 'all';
export type FeedbackCampaignListItem = FeedbackCampaign & { site_name: string };

export function useFeedback() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [summaries, setSummaries] = useState<FeedbackSummary[]>([]);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [campaigns, setCampaigns] = useState<FeedbackCampaignListItem[] | null>(null);
  const [error, setError] = useState('');
  const [siteSel, setSiteSel] = useState<SiteSelection>('all');
  const [surveySel, setSurveySel] = useState<string>('all');
  const [pendingDelete, setPendingDelete] = useState<FeedbackItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const siteId = siteSel === 'all' ? null : siteSel;
    const surveyId = surveySel === 'all' ? '' : surveySel;
    api
      .feedbackSummary(siteId, surveyId)
      .then((s) => {
        if (!cancelled) setSummaries(s);
      })
      .catch(() => {});
    api
      .listFeedback(siteId, surveyId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load feedback.');
      });
    return () => {
      cancelled = true;
    };
  }, [siteSel, surveySel]);

  const refreshCampaigns = useCallback(async () => {
    if (!sites) return;
    const selectedSites = siteSel === 'all' ? sites : sites.filter((site) => site.id === siteSel);
    try {
      const rows = await Promise.all(
        selectedSites.map(async (site) =>
          (await api.listFeedbackCampaigns(site.id)).map((campaign) => ({ ...campaign, site_name: site.name })),
        ),
      );
      setCampaigns(rows.flat());
    } catch {
      setError('Could not load feedback campaigns.');
      setCampaigns([]);
    }
  }, [sites, siteSel]);

  useEffect(() => {
    setCampaigns(null);
    void refreshCampaigns();
  }, [refreshCampaigns]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteFeedback(pendingDelete.id);
      setPendingDelete(null);
      setItems((rows) => (rows ? rows.filter((r) => r.id !== pendingDelete.id) : rows));
    } catch {
      setError('Could not delete feedback.');
    } finally {
      setDeleting(false);
    }
  }

  return {
    sites,
    campaigns,
    refreshCampaigns,
    summaries,
    items,
    error,
    siteSel,
    setSiteSel,
    surveySel,
    setSurveySel,
    pendingDelete,
    setPendingDelete,
    deleting,
    confirmDelete,
  };
}
