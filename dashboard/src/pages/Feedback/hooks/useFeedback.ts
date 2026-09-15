import { useEffect, useState } from 'react';
import { api, Feedback as FeedbackItem, FeedbackSummary, Site } from '../../../api';

type SiteSelection = number | 'all';

export function useFeedback() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [summaries, setSummaries] = useState<FeedbackSummary[]>([]);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
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

  return { sites, summaries, items, error, siteSel, setSiteSel, surveySel, setSurveySel, pendingDelete, setPendingDelete, deleting, confirmDelete };
}
