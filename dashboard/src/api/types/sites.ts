import { AnnouncementAppearance } from './announcements';
import { Feedback } from './feedback';
import { LogSettings } from './logs';
import { PerformanceKey } from './performance';
import { Session } from './sessions';

export type Site = {
  id: number;
  name: string;
  url: string;
  site_key: string;
  created_at: number;
  session_count: number;
  recording_enabled?: boolean;
  settings?: SiteSettings;
};

// Per-site configuration, managed in the dashboard and served to the tracker
// via the public config endpoint.
export type SurveyQuestion = {
  id: string;
  label: string;
  type: 'rating' | 'text' | 'choice';
  max?: number; // rating scale: 5 (stars) or 10 (NPS)
  options?: string[];
  optional?: boolean;
};

export type SiteAppearance = {
  button_bg?: string;
  button_text?: string;
  button_label?: string;
  panel_bg?: string;
  panel_text?: string;
  accent?: string;
  primary?: string;
  primary_text?: string;
  radius?: number;
  spacing?: number;
};

// When does the feedback widget show up for a visitor?
export type FeedbackTrigger = {
  mode: 'always' | 'page' | 'action';
  pages?: string[]; // URL patterns with * wildcards
  actions?: string[]; // trace-ux-track-id names / window.TraceUX.track names
};

export type WidgetSection = 'updates' | 'tickets' | 'feedback';

export type SiteSettings = {
  // The corner the single launcher anchors to. updates_position and
  // feedback_position predate the merge of the two widgets; the server mirrors
  // this value into both, and the dashboard writes all three together.
  widget_position?: string; // right | left
  // Master switch. Absent on sites configured before it existed, where the
  // widget showed whenever any section was on — so read it as
  // `widget_enabled ?? (updates_enabled || tickets_enabled || feedback_enabled)`.
  widget_enabled?: boolean;
  widget_section_order?: WidgetSection[];
  updates_enabled?: boolean;
  updates_position?: string;
  updates_appearance?: AnnouncementAppearance;
  feedback_enabled: boolean;
  feedback_position: string; // right | left
  tickets_enabled?: boolean;
  survey_id: string;
  survey_title: string;
  survey_type: string; // stars | nps | custom
  // Recordings (server-enforced):
  max_concurrent_sessions: number; // 0 = no limit
  retention_sessions_days: number; // 0 = server default
  retention_feedback_days: number; // 0 = server default
  allow_delete_recordings: boolean;
  logs: LogSettings;
  questions?: SurveyQuestion[];
  appearance?: SiteAppearance;
  feedback_trigger?: FeedbackTrigger;
};

export type SiteStats = {
  feedback_count: number;
  avg_rating: number;
  positive_pct: number;
};

// Metadata for the custom widget launcher icon. The image itself is served
// from the public, cached endpoint the URL points at, never inlined here.
export type WidgetIcon = {
  mime: string;
  etag: string;
  width: number;
  height: number;
  updated_at: number;
};

export type SiteDetail = {
  site: Site;
  sessions: Session[];
  feedback: Feedback[];
  stats: SiteStats;
  performance_keys: PerformanceKey[];
  widget_icon: WidgetIcon | null;
  widget_icon_url: string;
};
