import { Link } from 'react-router-dom';
import { Session } from '../../../api';
import { fmtDuration, fmtTime, formatCountry, stripProto, truncate } from '../../../lib/format';
import Badge from '../../../components/ui/Badge';
import { Icon } from '../../../components/ui/Icon';

type SessionRowProps = {
  session: Session;
  showSite: boolean;
  // Where the replay's back link should return, filters included.
  from: string;
  onOpen: () => void;
};

function visitorOf(s: Session) {
  return s.user_id || s.remote_id || s.client_id || '';
}

export function SessionRow({ session: s, showSite, from, onOpen }: SessionRowProps) {
  return (
    <tr className="is-clickable" onClick={onOpen}>
      <td>
        <div className="session-cell session-cell--visit">
          <span className="session-cell__primary">{fmtTime(s.started_at)}</span>
          <span className="session-cell__status">
            <Badge tone={s.active ? 'accent' : 'neutral'}>
              {s.active ? 'in-progress' : 'completed'}
            </Badge>
          </span>
        </div>
      </td>
      <td>
        <div className="session-context" title={s.referrer || 'direct'}>
          <span className="session-context__icon" aria-hidden>
            <Icon name="globe" size={13} />
          </span>
          <div className="session-cell session-cell--context">
            {showSite && <span className="session-cell__primary">{s.site_name ?? '—'}</span>}
            <span className={`${showSite ? 'session-cell__meta' : 'session-cell__primary'} mono`} title={visitorOf(s)}>
              {truncate(visitorOf(s) || 'anonymous', 26)}
            </span>
            <span className="session-cell__meta session-cell__meta--truncate">
              Referrer {s.referrer ? truncate(stripProto(s.referrer), 28) : 'direct'}
            </span>
          </div>
        </div>
      </td>
      <td>
        <div className="session-cell" title={[s.device, s.browser, s.os].filter(Boolean).join(' · ')}>
          <span className="session-cell__primary">{s.device || '—'}</span>
          <span className="session-cell__meta">{s.browser || '—'}</span>
          <span className="session-cell__meta">{s.os || '—'}</span>
        </div>
      </td>
      <td>
        <div className="session-cell session-cell--country" title={s.country || 'Country unavailable'}>
          <span className="session-cell__primary">{formatCountry(s.country)}</span>
          {s.country && <span className="session-cell__meta mono">{s.country}</span>}
        </div>
      </td>
      <td>
        <div className="session-cell session-cell--pages">
          <span className="session-cell__primary session-cell__primary--plain">
            {s.page_count} {s.page_count === 1 ? 'page' : 'pages'}
          </span>
          <span className="session-cell__meta">
            <strong>Length</strong> {fmtDuration(s.duration_ms)}
          </span>
        </div>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <Link
          to={`/replay/${s.id}?autoplay=1`}
          state={{ from }}
          className="btn btn--primary btn--sm play-btn"
          aria-label={`Play session from ${fmtTime(s.started_at)}`}
          title="Play recording"
        >
          <Icon name="play" size={12} />
        </Link>
      </td>
    </tr>
  );
}
