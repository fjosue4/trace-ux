import { KeyboardEvent } from 'react';
import { PerformanceEndpoint } from '../../../api';
import { fmtLatency, fmtNumber } from '../Performance.helpers';

type EndpointRowProps = {
  endpoint: PerformanceEndpoint;
  onOpen: (endpoint: PerformanceEndpoint) => void;
};

export function EndpointRow({ endpoint, onOpen }: EndpointRowProps) {
  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(endpoint);
    }
  }

  return (
    <tr tabIndex={0} onClick={() => onOpen(endpoint)} onKeyDown={onKeyDown} aria-label={`Open details for ${endpoint.endpoint}`}>
      <td><span className="performance-endpoint" title={endpoint.endpoint}>{endpoint.endpoint}</span></td>
      <td className="muted">{endpoint.site_name || '—'}</td>
      <td><span className="performance-dimension">{endpoint.environment}</span></td>
      <td><span className="performance-dimension">{endpoint.service}</span></td>
      <td><span className="performance-dimension mono">{endpoint.version}</span></td>
      <td className="mono">{fmtNumber(endpoint.requests)}</td>
      <td className="mono">{fmtLatency(endpoint.p50_ms)}</td>
      <td className="mono performance-latency--p95">{fmtLatency(endpoint.p95_ms)}</td>
      <td className="mono performance-latency--p99">{fmtLatency(endpoint.p99_ms)}</td>
    </tr>
  );
}
