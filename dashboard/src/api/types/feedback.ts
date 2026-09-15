// Visitor feedback / survey response (rating 1-5 = stars, 0-10 = NPS-style).
export type Feedback = {
  id: number;
  site_id: number;
  site_name?: string;
  session_id?: string;
  survey_id: string;
  rating: number;
  comment: string;
  answers?: { id: string; label?: string; value: string }[];
  created_at: number;
  browser?: string;
  os?: string;
  device?: string;
};

export type FeedbackSummary = {
  survey_id: string;
  count: number;
  average: number;
};
