import { request } from '../client';
import { Feedback, FeedbackSummary } from '../types/feedback';

export const feedbackEndpoints = {
  // Feedback & surveys.
  listFeedback: (siteId: number | null, surveyId: string) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (surveyId) q.set('survey_id', surveyId);
    return request<Feedback[]>(`/api/feedback?${q}`);
  },
  feedbackSummary: (siteId: number | null, surveyId: string) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (surveyId) q.set('survey_id', surveyId);
    return request<FeedbackSummary[]>(`/api/feedback/summary?${q}`);
  },
  deleteFeedback: (id: number) =>
    request<{ ok: boolean }>(`/api/feedback/${id}`, { method: 'DELETE' }),
};
