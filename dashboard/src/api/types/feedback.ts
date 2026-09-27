// Visitor feedback / survey response (rating 1-5 = stars, 0-10 = NPS-style).
export type Feedback = {
  id: number;
  site_id: number;
  site_name?: string;
  session_id?: string;
  visitor_key?: string;
  user_id?: string;
  survey_id: string;
  campaign_id?: number;
  campaign_key?: string;
  campaign_name?: string;
  campaign_answer_type?: 'sentiment' | 'stars' | 'scale_10';
  rating: number;
  comment: string;
  answers?: { id: string; label?: string; value: string }[];
  created_at: number;
  browser?: string;
  os?: string;
  device?: string;
};

export type FeedbackCampaign = {
  id: number;
  site_id: number;
  key: string;
  name: string;
  question: string;
  answer_type: 'sentiment' | 'stars' | 'scale_10';
  allow_comment: boolean;
  recurrence: 'every_occurrence' | 'daily' | 'weekly';
  placement: 'widget' | 'explicit';
  enabled: boolean;
  is_default: boolean;
  created_at: number;
  updated_at: number;
  response_count?: number;
  shown_count?: number;
  dismissed_count?: number;
  skipped_count?: number;
};

export type FeedbackCampaignInput = Pick<
  FeedbackCampaign,
  'site_id' | 'key' | 'name' | 'question' | 'answer_type' | 'allow_comment' | 'recurrence' | 'placement' | 'enabled'
>;

export type FeedbackSummary = {
  survey_id: string;
  campaign_id?: number;
  campaign_name?: string;
  campaign_answer_type?: 'sentiment' | 'stars' | 'scale_10';
  count: number;
  average: number;
};
