import { Link } from 'react-router-dom';
import { Session } from '../../../api';
import { fmtHourMinute, fmtDuration, fmtRelative, formatCountry, stripProto, urlPath } from '../../../lib/format';
import Badge from '../../../components/ui/Badge';
import { Icon } from '../../../components/ui/Icon';
import type { IconName } from '../../../components/ui/Icon';
import { replayPath } from '../Sessions.helpers';

type SessionRowProps = {
  session: Session;
  showSite: boolean;
  // Where the replay's back link should return, filters included.
  from: string;
  // The list's action filter, carried into the replay's actions search.
  actionFilter: string;
  onViewed: () => void;
  onOpen: () => void;
};

function visitorOf(s: Session) {
  return s.user_id || s.remote_id || s.client_id || '';
}

function deviceIcon(device: string): IconName {
  const d = device.toLowerCase();
  if (d.includes('mobile') || d.includes('phone')) return 'smartphone';
  if (d.includes('tablet')) return 'tablet';
  return 'monitor';
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function SessionRow({ session: s, showSite, from, actionFilter, onViewed, onOpen }: SessionRowProps) {
  const visitor = visitorOf(s);
  const actions = s.action_count ?? s.page_count;
  const entry = urlPath(s.initial_url) || '/';
  const exit = urlPath(s.exit_url);
  const singlePage = s.page_count <= 1 || !exit || exit === entry;
  const source = s.referrer ? `via ${stripProto(s.referrer).replace(/\/$/, '')}` : 'Direct';
  const context = [showSite ? s.site_name : null, source].filter(Boolean).join(' · ');

  return (
    <tr className={`session-row is-clickable${s.viewed ? ' is-viewed' : ''}`} onClick={() => { onViewed(); onOpen(); }}>
      <td className="col-fill session-row__visitor">
        <div className="cell-stack">
          <span className="cell-stack__main" title={visitor || 'Anonymous visitor'}>
            <span className={visitor ? 'mono' : 'session-row__anon'}>{visitor || 'Anonymous visitor'}</span>
            {s.active && <Badge tone="accent">Live</Badge>}
          </span>
          <span className="cell-stack__sub" title={s.referrer || 'Direct'}>{context}</span>
        </div>
      </td>
      <td className="col-fill session-row__journey">
        <div className="cell-stack">
          <span className="cell-stack__main mono" title={s.initial_url}>{entry}</span>
          <span className="cell-stack__sub" title={s.exit_url}>
            {singlePage ? (
              'Single page'
            ) : (
              <>
                <Icon name="arrowRight" size={11} /> <span className="mono">{exit}</span> · {s.page_count} pages
              </>
            )}
            {' · '}{actions} {actions === 1 ? 'action' : 'actions'}
          </span>
        </div>
      </td>
      <td className="col-fit session-row__device">
        <div className="cell-stack" title={[s.device, s.browser, s.os].filter(Boolean).join(' · ')}>
          <span className="cell-stack__main session-row__plain">
            <Icon name={deviceIcon(s.device || '')} size={14} /> {s.browser || '—'}
          </span>
          <span className="cell-stack__sub">{[capitalize(s.device), s.os].filter(Boolean).join(' · ') || '—'}</span>
        </div>
      </td>
      <td className="col-fit session-row__location">
        <span className="cell-stack__main session-row__plain" title={s.country || 'Country unavailable'}>
          {s.country ? formatCountry(s.country) : '—'}
        </span>
      </td>
      <td className="col-fit col-end session-row__length">
        <span className="cell-stack__main session-row__plain session-row__num">{fmtDuration(s.duration_ms)}</span>
      </td>
      <td className="col-fit session-row__started">
        <div className="cell-stack">
          <span className="cell-stack__main session-row__plain session-row__num">{fmtHourMinute(s.started_at)}</span>
          <span className="cell-stack__sub">{fmtRelative(s.started_at)}</span>
        </div>
      </td>
      <td className="col-fit col-end session-row__action" onClick={(e) => e.stopPropagation()}>
        <Link
          to={replayPath(s.id, { autoplay: true, action: actionFilter })}
          state={{ from }}
          className="btn btn--secondary btn--sm session-row__play"
          onClick={onViewed}
          aria-label={`${s.viewed ? 'Replay' : 'Play'} session from ${fmtHourMinute(s.started_at)}${s.viewed ? ', already played' : ''}`}
          title={s.viewed ? 'Replay recording · Already played' : 'Play recording'}
        >
          <Icon name={s.viewed ? 'replay' : 'play'} size={13} />
          {s.viewed ? 'Replay' : 'Play'}
        </Link>
      </td>
    </tr>
  );
}
