import { AnnouncementEngagement, AnnouncementEngagementEntry } from '../../../../api';

export type AudienceFilter = 'all' | 'liked' | 'commented';

// One row per visitor, however many ways they engaged. Likes and comments
// normally come after a read, but a visitor recorded before reads were kept can
// have one without the other, so every source can start a row.
export type AudienceMember = {
  visitorKey: string;
  userId: string;
  seenAt: number;
  likedAt: number;
  commentedAt: number;
  comment: string;
};

export function buildAudience(engagement: AnnouncementEngagement): AudienceMember[] {
  const byKey = new Map<string, AudienceMember>();
  const member = (entry: AnnouncementEngagementEntry) => {
    let row = byKey.get(entry.visitor_key);
    if (!row) {
      row = { visitorKey: entry.visitor_key, userId: '', seenAt: 0, likedAt: 0, commentedAt: 0, comment: '' };
      byKey.set(entry.visitor_key, row);
    }
    // Keep the first identity found; any source can be the one that has it.
    if (!row.userId && entry.user_id?.trim()) row.userId = entry.user_id.trim();
    return row;
  };
  for (const entry of engagement.reads ?? []) member(entry).seenAt = entry.created_at;
  for (const entry of engagement.reactions) member(entry).likedAt = entry.created_at;
  for (const entry of engagement.comments) {
    const row = member(entry);
    row.commentedAt = entry.created_at;
    row.comment = entry.body ?? '';
  }
  const lastActive = (row: AudienceMember) => Math.max(row.seenAt, row.likedAt, row.commentedAt);
  return [...byKey.values()].sort((a, b) => lastActive(b) - lastActive(a));
}

export function filterAudience(audience: AudienceMember[], filter: AudienceFilter) {
  if (filter === 'liked') return audience.filter((row) => row.likedAt > 0);
  if (filter === 'commented') return audience.filter((row) => row.commentedAt > 0);
  return audience;
}

// A visitor is only nameable when the host page passed one to identify().
// Everyone else still gets a row and a short key to tell them apart — missing
// identity is a fact to report, never a reason to hide what they did.
export function visitorName(userId: string | undefined) {
  return userId?.trim() || 'Anonymous visitor';
}

export function shortVisitorKey(visitorKey: string) {
  return visitorKey ? visitorKey.slice(0, 8) : '';
}

export function initials(userId: string | undefined) {
  const name = userId?.trim();
  if (!name) return '?';
  const local = name.includes('@') ? name.split('@')[0] : name;
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}

export function percentOf(part: number, whole: number) {
  if (whole <= 0) return '';
  return `${Math.round((part / whole) * 100)}%`;
}
