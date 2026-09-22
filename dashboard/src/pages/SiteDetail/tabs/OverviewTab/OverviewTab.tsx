import { Link } from 'react-router-dom';
import { fmtDuration, fmtTime, stripProto, truncate } from '../../../../lib/format';
import Card from '../../../../components/ui/Card';
import EmptyState from '../../../../components/ui/EmptyState';
import { Icon } from '../../../../components/ui/Icon';
import { OverviewTabProps } from './OverviewTab.types';

export function OverviewTab({ site, sessions, feedback, stats, latestLogs }: OverviewTabProps) {
  return (
    <>
      <div className="hub-stats">
        <Card className="hub-stat">
          <span className="hub-stat__label">Recordings</span>
          <strong className="hub-stat__num">{site.session_count}</strong>
        </Card>
        <Card className="hub-stat">
          <span className="hub-stat__label">Feedback responses</span>
          <strong className="hub-stat__num">{stats.feedback_count}</strong>
        </Card>
        <Card className="hub-stat">
          <span className="hub-stat__label">Positive feedback</span>
          <strong className="hub-stat__num">{stats.feedback_count > 0 ? `${Math.round(stats.positive_pct)}%` : '—'}</strong>
          <span className="muted small">
            {stats.feedback_count > 0 ? `avg ${stats.avg_rating.toFixed(1)}` : 'no responses yet'}
          </span>
        </Card>
      </div>

      <div className="hub-grid">
        <div className="hub-col">
          <h2>Latest recordings</h2>
          {sessions.length === 0 ? (
            <EmptyState
              title="No recordings yet"
              description="Install the snippet on your site and visitors will appear here."
            />
          ) : (
            <div className="hub-list">
              {sessions.map((s) => (
                <Link to={`/replay/${s.id}`} key={s.id} className="hub-row">
                  <span className="hub-row__icon">
                    <Icon name="play" size={13} />
                  </span>
                  <span className="hub-row__body">
                    <span className="hub-row__title">{truncate(stripProto(s.initial_url), 46)}</span>
                    <span className="muted small">{fmtTime(s.started_at)}</span>
                  </span>
                  <span className="chip">{fmtDuration(s.duration_ms)}</span>
                </Link>
              ))}
            </div>
          )}
          <Link to={`/sessions?site=${site.id}`} className="muted small">All recordings →</Link>
        </div>

        <div className="hub-col">
          <h2>Latest logs</h2>
          {latestLogs.length === 0 ? (
            <EmptyState
              title="No logs yet"
              description="Enable browser logs or connect a service to see recent output here."
            />
          ) : (
            <div className="hub-list">
              {latestLogs.map((log) => (
                <div key={log.id} className="hub-row">
                  <span className={`hub-row__icon hub-row__icon--log hub-row__icon--${log.severity}`}>{log.severity.slice(0, 3).toUpperCase()}</span>
                  <span className="hub-row__body">
                    <span className="hub-row__title">{truncate(log.message, 52)}</span>
                    <span className="muted small">
                      {log.service_name || 'Browser'}{log.environment ? ` · ${log.environment}` : ''} · {fmtTime(Math.floor(log.timestamp_ms / 1000))}
                      {log.extra ? ` · ${truncate(log.extra, 42)}` : ''}
                    </span>
                  </span>
                  {log.session_id && (
                    <Link to={`/replay/${log.session_id}`} className="icon-btn" title="Open replay">
                      <Icon name="play" size={13} />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
          <Link to={`/logs?site=${site.id}`} className="muted small">All logs →</Link>
        </div>

        <div className="hub-col">
          <h2>Latest feedback</h2>
          {feedback.length === 0 ? (
            <EmptyState
              title="No feedback yet"
              description="Enable the feedback section in the Widget tab to start collecting responses."
            />
          ) : (
            <div className="hub-list">
              {feedback.map((f) => (
                <div key={f.id} className="hub-row">
                  <span className="hub-row__icon hub-row__icon--rating">
                    {f.rating <= 5 ? `${f.rating}★` : f.rating}
                  </span>
                  <span className="hub-row__body">
                    <span className="hub-row__title">{f.comment || f.survey_id}</span>
                    <span className="muted small">
                      {(f.answers ?? []).map((a) => a.label || a.id).join(' · ') || f.browser || ''}
                      {f.created_at ? ` · ${fmtTime(f.created_at)}` : ''}
                    </span>
                  </span>
                  {f.session_id && (
                    <Link to={`/replay/${f.session_id}`} className="icon-btn" title="Open replay">
                      <Icon name="play" size={13} />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
          <Link to="/feedback" className="muted small">All feedback →</Link>
        </div>
      </div>
    </>
  );
}
