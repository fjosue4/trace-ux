import { PerformanceEndpoint } from '../../../api';
import { endpointKey, fmtLatency, fmtNumber } from '../Performance.helpers';

type EndpointRowProps = {
  endpoint: PerformanceEndpoint;
  isSelected: boolean;
  onSelect: (key: string) => void;
};

export function EndpointRow({ endpoint, isSelected, onSelect }: EndpointRowProps) {
  const key = endpointKey(endpoint);
  return (
    <tr className={isSelected ? 'is-selected' : ''} onClick={() => onSelect(key)}>
      <td><button type="button" className="performance-endpoint" title={endpoint.endpoint}>{endpoint.endpoint}</button></td>
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
