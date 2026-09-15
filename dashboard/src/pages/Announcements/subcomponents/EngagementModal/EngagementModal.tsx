import { Announcement, AnnouncementEngagementEntry } from '../../../../api';
import { fmtTime } from '../../../../lib/format';
import Modal from '../../../../components/ui/Modal';
import Button from '../../../../components/ui/Button';
import Notice from '../../../../components/ui/Notice';
import Loading from '../../../../components/ui/Loading';
import EmptyState from '../../../../components/ui/EmptyState';
import { Icon } from '../../../../components/ui/Icon';
import CreateTicketModal from '../../../../components/tickets/CreateTicketModal';
import { useEngagementModal } from './hooks/useEngagementModal';
import './EngagementModal.scss';

type EngagementModalProps = {
  announcement: Announcement | null;
  onClose: () => void;
};

// A visitor is only nameable when the host page passed one to identify().
// Everyone else is a browser, so say that rather than dressing up a random key.
function visitorLabel(entry: AnnouncementEngagementEntry) {
  return entry.user_id?.trim() || 'Anonymous visitor';
}

export default function EngagementModal({ announcement, onClose }: EngagementModalProps) {
  const { engagement, error, ticketTarget, setTicketTarget, openTicketFor } = useEngagementModal(
    announcement?.id ?? null,
    announcement?.title ?? '',
  );

  const reactions = engagement?.reactions ?? [];
  const comments = engagement?.comments ?? [];

  return (
    <>
      <Modal
        className="engagement-modal"
        open={announcement !== null}
        onClose={onClose}
        title={announcement?.title ?? 'Engagement'}
      >
        {error && <Notice tone="error">{error}</Notice>}
        {!error && engagement === null && <Loading />}

        {engagement !== null && (
          <>
            <section className="engagement-section">
              <h3>
                <Icon name="star" size={13} /> Likes
                <span className="engagement-count">{reactions.length}</span>
              </h3>
              {reactions.length === 0 ? (
                <p className="engagement-empty">Nobody has liked this yet.</p>
              ) : (
                <ul className="engagement-list">
                  {reactions.map((entry) => (
                    <li key={entry.visitor_key} className="engagement-row">
                      <span className="engagement-row__who">{visitorLabel(entry)}</span>
                      <span className="engagement-row__when">{fmtTime(entry.created_at)}</span>
                      <Button size="sm" variant="secondary" onClick={() => openTicketFor(entry, 'like')}>
                        Start a ticket
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="engagement-section">
              <h3>
                <Icon name="message" size={13} /> Comments
                <span className="engagement-count">{comments.length}</span>
              </h3>
              {comments.length === 0 ? (
                <p className="engagement-empty">No comments on this announcement.</p>
              ) : (
                <ul className="engagement-list">
                  {comments.map((entry) => (
                    <li key={entry.id} className="engagement-row engagement-row--comment">
                      <span className="engagement-row__who">{visitorLabel(entry)}</span>
                      <span className="engagement-row__when">{fmtTime(entry.created_at)}</span>
                      <Button size="sm" variant="secondary" onClick={() => openTicketFor(entry, 'comment')}>
                        Start a ticket
                      </Button>
                      <p className="engagement-row__body">{entry.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {reactions.length === 0 && comments.length === 0 && (
              <EmptyState
                title="No engagement yet"
                description="Reads, likes and comments appear here as visitors open the announcement in the widget."
              />
            )}
          </>
        )}
      </Modal>

      {announcement && ticketTarget && (
        <CreateTicketModal
          showModal
          toggleModalOpen={() => setTicketTarget(null)}
          siteId={announcement.site_id}
          visitorKey={ticketTarget.visitorKey}
          userId={ticketTarget.userId}
          defaultSubject={ticketTarget.subject}
          defaultBody={ticketTarget.quote ? `You wrote: “${ticketTarget.quote}”\n\n` : ''}
        />
      )}
    </>
  );
}
