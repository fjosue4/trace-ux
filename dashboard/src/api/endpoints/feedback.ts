import { request } from '../client';
import { Feedback, FeedbackCampaign, FeedbackCampaignInput, FeedbackSummary } from '../types/feedback';

export const feedbackEndpoints = {
  // Feedback & surveys.
  listFeedback: (siteId: number | null, surveyId: string, campaignId?: number | null) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    if (surveyId) q.set('survey_id', surveyId);
    if (campaignId) q.set('campaign_id', String(campaignId));
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
  listFeedbackCampaigns: (siteId: number) =>
    request<FeedbackCampaign[]>(`/api/feedback/campaigns?site_id=${siteId}`),
  createFeedbackCampaign: (input: FeedbackCampaignInput) =>
    request<FeedbackCampaign>('/api/feedback/campaigns', { method: 'POST', body: JSON.stringify(input) }),
  updateFeedbackCampaign: (id: number, input: FeedbackCampaignInput) =>
    request<FeedbackCampaign>(`/api/feedback/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
};
