import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, Log } from '../../../api';

/** The log open in the detail modal, kept in the URL as `/logs/log/<id>` so the
 *  address bar always holds a link to it. Opening pushes a history entry, so
 *  Back closes the modal; closing returns to `/logs`. A linked log that is
 *  not in the current list (older, or outside the filters) is fetched on its
 *  own. */
export function useLinkedLog(logs: Log[] | null) {
  const { logId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linkedId = readLogID(logId);
  const [openLog, setOpenLog] = useState<Log | null>(null);
  const [linkError, setLinkError] = useState('');

  // Preserve links copied during the brief query-param implementation.
  useEffect(() => {
    const legacyId = readLogID(params.get('log'));
    if (!legacyId) return;
    const next = new URLSearchParams(params);
    next.delete('log');
    navigate({ pathname: `/logs/log/${legacyId}`, search: next.toString() }, { replace: true });
  }, [navigate, params]);

  useEffect(() => {
    if (logId && !linkedId) {
      setOpenLog(null);
      setLinkError('That log link is invalid.');
      navigate({ pathname: '/logs', search: location.search }, { replace: true });
      return;
    }
    if (!linkedId) {
      setOpenLog(null);
      return;
    }
    if (openLog?.id === linkedId) return;
    const listed = logs?.find((log) => log.id === linkedId);
    if (listed) {
      setOpenLog(listed);
      return;
    }
    let cancelled = false;
    api
      .getLog(linkedId)
      .then((log) => {
        if (!cancelled) {
          setLinkError('');
          setOpenLog(log);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLinkError(
          e instanceof ApiError && e.status === 404
            ? 'That log no longer exists. It may have been removed by the site’s log retention.'
            : 'Could not open the linked log.',
        );
        navigate({ pathname: '/logs', search: location.search }, { replace: true });
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the id: a refreshed list must not refetch or reopen the log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedId]);

  const open = useCallback((log: Log) => {
    setLinkError('');
    setOpenLog(log);
    navigate({ pathname: `/logs/log/${log.id}`, search: location.search });
  }, [location.search, navigate]);

  const close = useCallback(() => {
    setOpenLog(null);
    navigate({ pathname: '/logs', search: location.search }, { replace: true });
  }, [location.search, navigate]);

  return { openLog, open, close, linkError };
}

function readLogID(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}
