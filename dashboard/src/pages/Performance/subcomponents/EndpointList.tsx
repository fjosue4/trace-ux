import { useState } from 'react';
import { PerformanceEndpoint } from '../../../api';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import FilterPanel from '../../../components/ui/FilterPanel';
import Table from '../../../components/ui/Table';
import { Select } from '../../../components/ui/fields';
import { compareVersions, endpointKey, latestEndpointVersions } from '../Performance.helpers';
import { EndpointRow } from './EndpointRow';

type EndpointListProps = {
  endpoints: PerformanceEndpoint[];
  onOpen: (endpoint: PerformanceEndpoint) => void;
};

export function EndpointList({ endpoints, onOpen }: EndpointListProps) {
  const [environment, setEnvironment] = useState('all');
  const [service, setService] = useState('all');
  const [version, setVersion] = useState('latest');
  const environments = [...new Set(endpoints.map((endpoint) => endpoint.environment))].sort();
  const scopedEnvironment = environments.includes(environment) ? environment : 'all';
  const environmentEndpoints = endpoints.filter((endpoint) => scopedEnvironment === 'all' || endpoint.environment === scopedEnvironment);
  const services = [...new Set(environmentEndpoints.map((endpoint) => endpoint.service))].sort();
  const scopedService = services.includes(service) ? service : 'all';
  const scopedEndpoints = environmentEndpoints.filter((endpoint) => scopedService === 'all' || endpoint.service === scopedService);
  const versions = [...new Set(scopedEndpoints.map((endpoint) => endpoint.version))].sort((a, b) => compareVersions(b, a));
  const scopedVersion = version === 'all' || version === 'latest' || versions.includes(version.slice('version:'.length)) ? version : 'latest';
  const visibleEndpoints = scopedVersion === 'latest'
    ? latestEndpointVersions(scopedEndpoints)
    : scopedEndpoints.filter((endpoint) => scopedVersion === 'all' || endpoint.version === scopedVersion.slice('version:'.length));

  function reset() {
    setEnvironment('all');
    setService('all');
    setVersion('latest');
  }

  return (
    <section aria-label="Endpoints">
      <div className="performance-table-head">
        <div>
          <h2>Endpoints</h2>
          <p className="muted small">Sorted by p95 latency. Click a row to view endpoint details.</p>
        </div>
      </div>
      <FilterPanel
        title="Filter endpoints"
        actions={<Button variant="ghost" size="sm" onClick={reset}>Reset</Button>}
        footer={(
          <>
            <span className="muted small">{visibleEndpoints.length} of {endpoints.length} endpoints</span>
            <span className="muted small">{scopedVersion === 'latest' ? 'Latest version per service and environment.' : 'Filters apply to the endpoint list.'}</span>
          </>
        )}
      >
        <Select
          ariaLabel="Endpoint environment"
          value={scopedEnvironment}
          onChange={(value) => { setEnvironment(value); setService('all'); setVersion('latest'); }}
          options={[{ value: 'all', label: 'All environments' }, ...environments.map((value) => ({ value, label: value }))]}
        />
        <Select
          ariaLabel="Endpoint service"
          value={scopedService}
          onChange={(value) => { setService(value); setVersion('latest'); }}
          options={[{ value: 'all', label: 'All services' }, ...services.map((value) => ({ value, label: value }))]}
        />
        <Select
          ariaLabel="Endpoint version"
          value={scopedVersion}
          onChange={setVersion}
          options={[
            { value: 'latest', label: 'Latest version' },
            { value: 'all', label: 'All versions' },
            ...versions.map((value) => ({ value: `version:${value}`, label: value })),
          ]}
        />
      </FilterPanel>
      {visibleEndpoints.length === 0 ? (
        <EmptyState title="No endpoints match" description="Try another environment, service, or version." />
      ) : (
        <Table
          className="performance-table"
          fixed
          widths={['27%', '12%', '13%', '13%', '11%', '7%', '7%', '7%', '8%']}
          headers={['Endpoint', 'Site', 'Environment', 'Service', 'Version', 'Requests', 'p50', 'p95', 'p99']}
        >
          {visibleEndpoints.map((endpoint) => <EndpointRow key={endpointKey(endpoint)} endpoint={endpoint} onOpen={onOpen} />)}
        </Table>
      )}
    </section>
  );
}
