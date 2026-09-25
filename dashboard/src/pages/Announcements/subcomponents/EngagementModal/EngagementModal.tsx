import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { Announcement } from '../../../../api';
import { fmtTime } from '../../../../lib/format';
import Modal from '../../../../components/ui/Modal';
import Badge from '../../../../components/ui/Badge';
import Button from '../../../../components/ui/Button';
import Notice from '../../../../components/ui/Notice';
import Loading from '../../../../components/ui/Loading';
import { Icon } from '../../../../components/ui/Icon';
import { DetailEmpty, DetailMeta, DetailPane } from '../../../../components/ui/DetailModal';
import CreateTicketModal from '../../../../components/tickets/CreateTicketModal';
import { useEngagementModal } from './hooks/useEngagementModal';
import {
  AudienceFilter,
  AudienceMember,
  buildAudience,
  filterAudience,
  initials,
  percentOf,
  shortVisitorKey,
  visitorName,
} from './EngagementModal.helpers';
import './EngagementModal.scss';

type EngagementModalProps = {
  announcement: Announcement | null;
  onClose: () => void;
};

const FILTERS: { value: AudienceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'liked', label: 'Liked' },
  { value: 'commented', label: 'Commented' },
];

// Who saw an announcement and what they did with it, laid out like the log
// details view: the facts in a strip, then what visitors wrote beside who they
// are.
export default function EngagementModal({ announcement, onClose }: EngagementModalProps) {
  const { engagement, error, ticketTarget, setTicketTarget, openTicketFor } = useEngagementModal(
    announcement?.id ?? null,
    announcement?.title ?? '',
  );
  const [filter, setFilter] = useState<AudienceFilter>('all');

  useEffect(() => setFilter('all'), [announcement?.id]);

  const audience = useMemo(() => (engagement ? buildAudience(engagement) : []), [engagement]);
  const shown = filterAudience(audience, filter);
  const comments = engagement?.comments ?? [];
  const likes = engagement?.reactions.length ?? 0;
  // A server that predates attributed reads still reports how many there were.
  const reads = engagement?.reads ? engagement.reads.length : (announcement?.reads ?? 0);

  return (
    <>
      <Modal
        className="detail-modal engagement-modal"
        open={announcement !== null}
        onClose={onClose}
        title={announcement?.title ?? 'Engagement'}
        footer={<Button variant="primary" size="sm" onClick={onClose}>Close</Button>}
      >
        {error && <Notice tone="error">{error}</Notice>}
        {!error && engagement === null && <Loading />}

        {announcement && engagement !== null && (
          <>
            <DetailMeta
              items={[
                {
                  label: 'Status',
                  value: <Badge tone={announcement.status === 'published' ? 'accent' : 'neutral'}>{announcement.status}</Badge>,
                },
                { label: 'Published', value: announcement.published_at ? fmtTime(announcement.published_at) : 'Not yet' },
                { label: 'Site', value: announcement.site_name || '—' },
                { label: 'Seen by', value: <Stat value={reads} /> },
                { label: 'Likes', value: <Stat value={likes} share={percentOf(likes, reads)} /> },
                { label: 'Comments', value: <Stat value={comments.length} share={percentOf(comments.length, reads)} /> },
              ]}
            />

            <div className="engagement-panes">
              <DetailPane label="Comments" icon={<Icon name="message" size={13} />} count={comments.length}>
                {comments.length === 0 ? (
                  <DetailEmpty>No comments yet. What visitors write under this announcement shows up here.</DetailEmpty>
                ) : (
                  <ul className="engagement-box engagement-comments">
                    {comments.map((entry) => (
                      <li key={entry.id} className="engagement-comment">
                        <div className="engagement-comment__head">
                          <Person userId={entry.user_id} visitorKey={entry.visitor_key} detail={fmtTime(entry.created_at)} />
                          <TicketButton onClick={() => openTicketFor(entry.visitor_key, entry.user_id ?? '', entry.body ?? '')} />
                        </div>
                        <p className="engagement-comment__body">{entry.body?.trim() || <em className="muted">(empty comment)</em>}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </DetailPane>

              <DetailPane
                label="Seen by"
                icon={<Icon name="eye" size={13} />}
                count={audience.length}
                actions={
                  audience.length > 0 && (
                    <span className="engagement-filter" role="tablist" aria-label="Filter visitors">
                      {FILTERS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="tab"
                          aria-selected={filter === option.value}
                          className={classNames('engagement-filter__option', { 'is-active': filter === option.value })}
                          onClick={() => setFilter(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </span>
                  )
                }
              >
                {audience.length === 0 ? (
                  <DetailEmpty>
                    {reads > 0
                      ? `${reads} ${reads === 1 ? 'visitor has' : 'visitors have'} seen this. Their names appear here once the server is updated.`
                      : 'Nobody has opened this announcement in the widget yet.'}
                  </DetailEmpty>
                ) : shown.length === 0 ? (
                  <DetailEmpty>Nobody here {filter === 'liked' ? 'liked' : 'commented on'} this announcement.</DetailEmpty>
                ) : (
                  <ul className="engagement-box engagement-audience">
                    {shown.map((row) => (
                      <AudienceRow key={row.visitorKey} row={row} onTicket={() => openTicketFor(row.visitorKey, row.userId, row.comment)} />
                    ))}
                  </ul>
                )}
              </DetailPane>
            </div>
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

function Stat({ value, share }: { value: number; share?: string }) {
  return (
    <span className="engagement-stat">
      <strong>{value}</strong>
      {share && value > 0 && (
        <span className="muted">
          {' · '}{share}<span className="engagement-stat__of"> of readers</span>
        </span>
      )}
    </span>
  );
}

function Person({ userId, visitorKey, detail }: { userId?: string; visitorKey: string; detail: string }) {
  const known = Boolean(userId?.trim());
  return (
    <span className="engagement-person">
      <span className={classNames('engagement-avatar', { 'is-anonymous': !known })} aria-hidden>
        {initials(userId)}
      </span>
      <span className="engagement-person__text">
        <span className="engagement-person__name">
          <span className="engagement-person__label" title={userId?.trim() || undefined}>{visitorName(userId)}</span>
          {!known && visitorKey && <code className="engagement-person__key">{shortVisitorKey(visitorKey)}</code>}
        </span>
        <span className="engagement-person__detail">{detail}</span>
      </span>
    </span>
  );
}

function AudienceRow({ row, onTicket }: { row: AudienceMember; onTicket: () => void }) {
  const detail = row.seenAt ? `Seen ${fmtTime(row.seenAt)}` : 'Seen before reads were tracked';
  return (
    <li className="engagement-audience__row">
      <Person userId={row.userId} visitorKey={row.visitorKey} detail={detail} />
      <span className="engagement-audience__tags">
        {row.likedAt > 0 && (
          <span className="engagement-tag engagement-tag--like" title={`Liked ${fmtTime(row.likedAt)}`}>
            <Icon name="star" size={11} /> Liked
          </span>
        )}
        {row.commentedAt > 0 && (
          <span className="engagement-tag" title={`Commented ${fmtTime(row.commentedAt)}`}>
            <Icon name="message" size={11} /> Commented
          </span>
        )}
      </span>
      <TicketButton compact onClick={onTicket} />
    </li>
  );
}

// The audience list is the narrow column, so its rows carry the icon alone.
function TicketButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={classNames('engagement-ticket', { 'engagement-ticket--icon': compact })}
      onClick={onClick}
      title={compact ? 'Start a ticket' : undefined}
      aria-label="Start a ticket"
    >
      <Icon name="lifebuoy" size={13} />
      {!compact && <span className="engagement-ticket__label">Start ticket</span>}
    </Button>
  );
}
