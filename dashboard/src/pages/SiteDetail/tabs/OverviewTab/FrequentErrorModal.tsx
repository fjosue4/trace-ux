import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, FrequentError, Log } from '../../../../api';
import { stripProto, truncate } from '../../../../lib/format';
import Loading from '../../../../components/ui/Loading';
import Modal from '../../../../components/ui/Modal';
import Notice from '../../../../components/ui/Notice';
import { Icon } from '../../../../components/ui/Icon';
import { formatExtra } from '../../../Logs/Logs.helpers';

const PAGE_SIZE = 50;

function formatOccurrenceTime(timestampMs: number) {
  return new Date(timestampMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

type FrequentErrorModalProps = {
  error: FrequentError | null;
  fromMs: number;
  onClose: () => void;
};

export function FrequentErrorModal({ error, fromMs, onClose }: FrequentErrorModalProps) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const requestGeneration = useRef(0);

  const fetchPage = useCallback(async (reset: boolean) => {
    if (!error || !fromMs || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError('');
    const generation = requestGeneration.current;
    const beforeId = reset ? undefined : logs[logs.length - 1]?.id;
    try {
      const page = await api.frequentErrorOccurrences(error.representative_id, {
        fromMs,
        beforeId,
        limit: PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setLogs((current) => reset ? page : [...current, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      if (requestGeneration.current === generation) setLoadError('Could not load these error occurrences.');
    } finally {
      if (requestGeneration.current === generation) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [error, fromMs, logs]);

  useEffect(() => {
    requestGeneration.current += 1;
    loadingRef.current = false;
    setLogs([]);
    setHasMore(false);
    setLoadError('');
    if (error) void fetchPage(true);
    // fetchPage also changes when a page is appended; only a selected error
    // should reset the list and trigger its first request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error?.representative_id, fromMs]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !error || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchPage(false);
      },
      { root, rootMargin: '160px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMore, fetchPage]);

  return (
    <Modal
      open={error !== null}
      onClose={onClose}
      title={error ? `${error.count.toLocaleString()} occurrences` : 'Error occurrences'}
      className="frequent-errors-modal"
    >
      {error && (
        <>
          <p className="frequent-errors-modal__window">Exact matches from the last 7 days</p>
          <pre className="frequent-errors-modal__message">{error.message}</pre>
          {loadError && <Notice tone="error">{loadError}</Notice>}
          <div ref={scrollRef} className="frequent-errors-modal__scroll">
            <div className="frequent-errors-modal__list">
              {logs.map((log) => {
                const extra = formatExtra(log.extra);
                return (
                  <div className="frequent-errors-modal__row" key={log.id}>
                    <span className="hub-row__icon hub-row__icon--log hub-row__icon--error">ERR</span>
                    <div className="frequent-errors-modal__details">
                      <div className="frequent-errors-modal__primary">
                        <strong className="frequent-errors-modal__time">{formatOccurrenceTime(log.timestamp_ms)}</strong>
                        <span aria-hidden="true">·</span>
                        <span className="frequent-errors-modal__service">{log.service_name || 'Browser'}</span>
                      </div>
                      <div className="frequent-errors-modal__context">
                        {extra && <code title={extra.compact}>{truncate(extra.compact, 100)}</code>}
                        {extra && log.url && <span aria-hidden="true"> · </span>}
                        {log.url && <span title={log.url}>{truncate(stripProto(log.url), 80)}</span>}
                        {!extra && !log.url && <span>No additional context</span>}
                      </div>
                    </div>
                    <div className="frequent-errors-modal__source">
                      {log.session_id ? (
                        <Link
                          to={`/replay/${log.session_id}`}
                          className="btn btn--secondary btn--sm frequent-errors-modal__replay"
                          title={log.url ? stripProto(log.url) : 'Open recording'}
                        >
                          <Icon name="play" size={11} /> Replay
                        </Link>
                      ) : (
                        <span className="frequent-errors-modal__api">API</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={sentinelRef} className="frequent-errors-modal__sentinel" aria-hidden="true" />
            </div>
            {loading && <Loading />}
            {!loading && logs.length === 0 && !loadError && <p className="muted small">No matching errors remain in this window.</p>}
            {!loading && !hasMore && logs.length > 0 && <p className="frequent-errors-modal__end muted small">All occurrences loaded</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
