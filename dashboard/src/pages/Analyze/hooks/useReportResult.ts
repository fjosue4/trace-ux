import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnalyzeRange, AnalyzeReport, AnalyzeResult, api, ApiError } from '../../../api';
import { addDays, dateInZone, definitionWindow, parseWindowKey, rangeForWindow, windowKey } from '../Analyze.helpers';
import { RangeChoice } from '../Analyze.types';

function readChoice(value: string | null): RangeChoice {
  if (value === 'custom') return value;
  // Bare numbers are day counts, from links made before hour windows.
  const window = parseWindowKey(value && /^\d+$/.test(value) ? `d${value}` : value);
  return window ? windowKey(window) : 'default';
}

/** Loads one saved report and evaluates it. The range is held in the URL and
 *  never written back to the report: it is a temporary lens, not an edit. */
export function useReportResult(reportId: number) {
  const [params, setParams] = useSearchParams();
  const choice = readChoice(params.get('range'));
  const customFrom = params.get('from') ?? '';
  const customTo = params.get('to') ?? '';

  const [report, setReport] = useState<AnalyzeReport | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setNotFound(false);
    setError('');
    if (!Number.isInteger(reportId) || reportId <= 0) {
      setNotFound(true);
      return;
    }
    api.getAnalyzeReport(reportId)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e instanceof Error ? e.message : 'Could not load the report.');
      });
    return () => { cancelled = true; };
  }, [reportId]);

  const customError = useMemo(() => {
    if (choice !== 'custom') return '';
    if (!customFrom || !customTo) return 'Choose a start and an end date.';
    if (customFrom > customTo) return 'The start date must be on or before the end date.';
    return '';
  }, [choice, customFrom, customTo]);

  const range = useMemo<AnalyzeRange | null>(() => {
    if (choice === 'default') return {};
    if (choice === 'custom') return customError ? null : { from: customFrom, to: addDays(customTo, 1) };
    const window = parseWindowKey(choice);
    return window ? rangeForWindow(window) : {};
  }, [choice, customFrom, customTo, customError]);

  useEffect(() => {
    if (!report || !range) return;
    let cancelled = false;
    setLoading(true);
    api.analyzeReportResults(report.id, range)
      .then((next) => { if (!cancelled) { setResult(next); setError(''); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e instanceof Error ? e.message : 'Could not calculate the report.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [report, range, refreshNonce]);

  const setChoice = useCallback((next: RangeChoice) => {
    setParams((current) => {
      const p = new URLSearchParams(current);
      if (next === 'default') p.delete('range');
      else p.set('range', next);
      if (next === 'custom' && !p.get('from') && report) {
        // Seed the custom range with the saved window, in whole days: custom
        // ranges are calendar dates.
        const zone = report.definition.timezone;
        const saved = definitionWindow(report.definition);
        const days = saved.days ?? Math.ceil(saved.hours / 24);
        const to = dateInZone(Date.now(), zone);
        p.set('to', to);
        p.set('from', addDays(to, -(days - 1)));
      }
      if (next !== 'custom') { p.delete('from'); p.delete('to'); }
      return p;
    }, { replace: true });
  }, [setParams, report]);

  const setCustom = useCallback((key: 'from' | 'to', value: string) => {
    setParams((current) => {
      const p = new URLSearchParams(current);
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    }, { replace: true });
  }, [setParams]);

  return {
    report,
    setReport,
    notFound,
    result,
    loading,
    error,
    setError,
    choice,
    setChoice,
    customFrom,
    customTo,
    setCustom,
    customError,
    refresh: () => setRefreshNonce((n) => n + 1),
  };
}
