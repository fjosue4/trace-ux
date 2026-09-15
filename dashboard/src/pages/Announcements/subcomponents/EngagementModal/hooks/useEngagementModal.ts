import { useEffect, useState } from 'react';
import { AnnouncementEngagement, AnnouncementEngagementEntry, api } from '../../../../../api';

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
      .catch(() => {
        if (!cancelled) setError('Could not load who engaged with this announcement.');
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
