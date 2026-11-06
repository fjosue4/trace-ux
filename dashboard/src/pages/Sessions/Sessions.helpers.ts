type ReplayLinkOptions = {
  /** Start playing as soon as the recording loads. */
  autoplay?: boolean;
  /** The list's action filter. The replay opens with its actions panel
   *  already searching for it, so the matching moments are what you see. */
  action?: string;
};

/** The replay URL for a session opened from the Sessions list. */
export function replayPath(sessionId: string, { autoplay = false, action = '' }: ReplayLinkOptions = {}): string {
  const query = new URLSearchParams();
  if (autoplay) query.set('autoplay', '1');
  if (action.trim()) query.set('action', action.trim());
  const suffix = query.toString();
  return `/replay/${encodeURIComponent(sessionId)}${suffix ? `?${suffix}` : ''}`;
}
