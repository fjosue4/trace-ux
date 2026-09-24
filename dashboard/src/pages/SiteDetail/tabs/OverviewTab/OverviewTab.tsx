import { CSSProperties, useState } from 'react';
import { Link } from 'react-router-dom';
import { FrequentError } from '../../../../api';
import { fmtDuration, fmtTime, stripProto, truncate } from '../../../../lib/format';
import Card from '../../../../components/ui/Card';
import EmptyState from '../../../../components/ui/EmptyState';
import { Icon } from '../../../../components/ui/Icon';
import { OverviewTabProps } from './OverviewTab.types';
import { FrequentErrorModal } from './FrequentErrorModal';

export function OverviewTab({ site, sessions, feedback, stats, frequentErrors, frequentErrorsFromMs }: OverviewTabProps) {
  const [selectedError, setSelectedError] = useState<FrequentError | null>(null);
  const highestErrorCount = frequentErrors[0]?.count ?? 1;

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
          <h2>Top errors <span className="hub-col__range">Last 7 days</span></h2>
          {frequentErrors.length === 0 ? (
            <EmptyState
              title="No errors in the last 7 days"
              description="Errors captured from the browser and connected services will appear here."
            />
          ) : (
            <div className="hub-list">
              {frequentErrors.map((error) => (
                <button
                  type="button"
                  key={error.representative_id}
                  className="hub-row hub-row--button hub-row--frequency"
                  onClick={() => setSelectedError(error)}
                  aria-label={`Show ${error.count} occurrences of ${error.message}`}
                  style={{ '--error-frequency': `${(error.count / highestErrorCount) * 100}%` } as CSSProperties}
                >
                  <span className="hub-row__icon hub-row__icon--log hub-row__icon--error">ERR</span>
                  <span className="hub-row__body">
                    <span className="hub-row__title">{truncate(error.message, 52)}</span>
                    <span className="muted small">
                      Last seen {fmtTime(Math.floor(error.last_seen_ms / 1000))}
                    </span>
                  </span>
                  <span className="hub-row__count" title={`${error.count} occurrences`}>{error.count.toLocaleString()}</span>
                  <span className="hub-row__arrow" aria-hidden="true">→</span>
                </button>
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

      <FrequentErrorModal
        error={selectedError}
        fromMs={frequentErrorsFromMs}
        onClose={() => setSelectedError(null)}
      />
    </>
  );
}
