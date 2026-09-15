import { useEffect, useState } from 'react';
import { AnnouncementEngagement, AnnouncementEngagementEntry, api, ApiError } from '../../../../../api';

export type TicketTarget = {
  visitorKey: string;
  userId?: string;
  subject: string;
  quote: string;
};

export function useEngagementModal(announcementId: number | null, announcementTitle: string) {
  const [engagement, setEngagement] = useState<AnnouncementEngagement | null>(null);
  const [error, setError] = useState('');
  const [ticketTarget, setTicketTarget] = useState<TicketTarget | null>(null);

  useEffect(() => {
    if (!announcementId) {
      setEngagement(null);
      return;
    }
    let cancelled = false;
    setEngagement(null);
    setError('');
    api
      .getAnnouncementEngagement(announcementId)
      .then((next) => {
        if (!cancelled) setEngagement(next);
      })
      .catch((caught) => {
        if (cancelled) return;
        // Say which failure this is. A 404 here means the server predates the
        // engagement endpoint, which is a rebuild away, not a data problem.
        if (caught instanceof ApiError && caught.status === 404) {
          setError('This TraceUX server does not have the engagement endpoint yet — rebuild and restart it.');
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Could not load who engaged with this announcement.');
      });
    return () => {
      cancelled = true;
    };
  }, [announcementId]);

  function openTicketFor(entry: AnnouncementEngagementEntry, kind: 'like' | 'comment') {
    setTicketTarget({
      visitorKey: entry.visitor_key,
      userId: entry.user_id,
      subject: `Re: ${announcementTitle}`,
      quote: kind === 'comment' ? entry.body ?? '' : '',
    });
  }

  return { engagement, error, ticketTarget, setTicketTarget, openTicketFor };
}
