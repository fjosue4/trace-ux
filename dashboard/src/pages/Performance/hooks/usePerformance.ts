import { useEffect, useMemo, useState } from 'react';
import { api, PerformanceReport, Site } from '../../../api';
import { endpointKey, timeBounds } from '../Performance.helpers';
import { SiteSelection, TimeRange } from '../Performance.types';

export function usePerformance() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [siteSel, setSiteSel] = useState<SiteSelection>('all');
  const [environment, setEnvironment] = useState('all');
  const [service, setService] = useState('all');
  const [version, setVersion] = useState('all');
  const [range, setRange] = useState<TimeRange>('24h');
  const [selectedKey, setSelectedKey] = useState('');
  const [live, setLive] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listSites().then(setSites).catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let fetching = false;

    async function load() {
      if (fetching) return;
      fetching = true;
      const bounds = timeBounds(range);
      try {
        const next = await api.performance({
          siteId: siteSel === 'all' ? null : siteSel,
          environment: environment === 'all' ? undefined : environment,
          service: service === 'all' ? undefined : service,
          version: version === 'all' ? undefined : version,
          from: bounds.from,
          to: bounds.to,
          limit: 200,
        });
        if (!cancelled) {
          setReport(next);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load performance data.');
      } finally {
        fetching = false;
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    load();
    const timer = live ? window.setInterval(load, 30_000) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [siteSel, environment, service, version, range, live, refreshNonce]);

  useEffect(() => {
    if (!report || report.endpoints.length === 0) {
      setSelectedKey('');
      return;
    }
    setSelectedKey((current) => (report.endpoints.some((endpoint) => endpointKey(endpoint) === current)
      ? current
      : endpointKey(report.endpoints[0])));
  }, [report]);

  const selected = useMemo(
    () => report?.endpoints.find((endpoint) => endpointKey(endpoint) === selectedKey) ?? report?.endpoints[0],
    [report, selectedKey],
  );

  const filterOptions = report?.filters ?? { environments: [], services: [], versions: [] };
  const siteOptions = [
    { value: 'all', label: 'All sites' },
    ...(sites ?? []).map((site) => ({ value: String(site.id), label: site.name })),
  ];

  return {
    report,
    siteSel,
    setSiteSel,
    environment,
    setEnvironment,
    service,
    setService,
    version,
    setVersion,
    range,
    setRange,
    selectedKey,
    setSelectedKey,
    live,
    setLive,
    setRefreshNonce,
    loading,
    error,
    selected,
    filterOptions,
    siteOptions,
  };
}
