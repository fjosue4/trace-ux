export type AnnouncementAppearance = {
  theme?: 'light' | 'dark';
  button_bg?: string; button_text?: string; button_label?: string; panel_bg?: string;
  panel_text?: string; accent?: string; action_bg?: string; action_text?: string;
  radius?: number; max_width?: number;
};

export type AnnouncementStatus = 'draft' | 'published' | 'archived';
export type Announcement = {
  id: number; site_id: number; site_name?: string; title: string; summary: string; body: string;
  release_label: string; link_url: string; status: AnnouncementStatus; published_at: number;
  created_at: number; updated_at: number; reactions: number; comments: number; reads: number;
};
