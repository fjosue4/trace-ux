import { Link } from 'react-router-dom';
import { fmtTime } from '../../../../lib/format';
import Card from '../../../../components/ui/Card';
import Button from '../../../../components/ui/Button';
import { Icon } from '../../../../components/ui/Icon';
import { Input } from '../../../../components/ui/fields';
import SnippetCard from '../../../../components/sites/SnippetCard';
import { useSiteUrl } from './hooks/useSiteUrl';
import { useSitePerformanceKeys } from './hooks/useSitePerformanceKeys';
import { SiteTabProps } from './SiteTab.types';

export function SiteTab({ id, site, detail, isAdmin, onDetailChanged, onError }: SiteTabProps) {
  const { urlDraft, setUrlDraft, urlSaving, saveURL } = useSiteUrl(id, onDetailChanged, onError);
  const {
    performanceKeys,
    newPerformanceKey,
    performanceKeySaving,
    performanceKeyCopied,
    performanceExampleCopied,
    createPerformanceKey,
    copyPerformanceKey,
    copyPerformanceExample,
    removePerformanceKey,
  } = useSitePerformanceKeys(id, detail, onError);

  const exampleCommand = `curl -X POST "${location.origin}/api/performance/ingest/${site.site_key}" \\
  -H "Content-Type: application/json" \\
  -H "X-TraceUX-Performance-Key: $TRACE_UX_PERFORMANCE_KEY" \\
  -d '{"observations":[
    {"environment":"production","service":"api","version":"1.4.0","endpoint":"GET /orders","duration_ms":184,"status_code":200}
  ]}'`;

  return (
    <>
      <Card className="site-url">
        <form
          className="row row--between"
          onSubmit={(e) => {
            e.preventDefault();
            saveURL();
          }}
        >
          <div className="site-url__info">
            <strong>
              <Icon name="globe" size={13} /> Website URL
            </strong>
            <span className="muted small">
              Recordings are only accepted from this origin — update it if the site moves.
            </span>
          </div>
          {isAdmin ? (
            <div className="row">
              <Input
                value={urlDraft ?? site.url}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://your-site.com"
                inputMode="url"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={urlSaving || (urlDraft ?? site.url).trim() === site.url}
              >
                {urlSaving ? 'Saving…' : 'Save URL'}
              </Button>
            </div>
          ) : (
            <span className="small">{site.url || '—'}</span>
          )}
        </form>
      </Card>

      <Card className="site-performance-key">
        <div className="site-performance-key__head">
          <div className="site-url__info">
            <strong><Icon name="activity" size={13} /> Backend performance</strong>
            <span className="muted small">
              This connects your application server to TraceUX. It is not used by the browser
              tracker and does not instrument your backend automatically.
            </span>
          </div>
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={createPerformanceKey} disabled={performanceKeySaving}>
              <Icon name="plus" size={13} />
              {performanceKeySaving ? 'Creating…' : performanceKeys.length ? 'Create another key' : 'Create key'}
            </Button>
          )}
        </div>

        <div className="site-performance-key__steps">
          <strong>Connect your backend in 3 steps</strong>
          <ol>
            <li>Create a key and save the raw value as <code>TRACE_UX_PERFORMANCE_KEY</code> on your backend.</li>
            <li>Measure requests in your application and send observations to the endpoint below.</li>
            <li>Open <Link to="/performance">Performance</Link> to see the resulting percentiles.</li>
          </ol>
          <p className="muted small">
            The <strong>site key</strong> identifies this site in the URL. The <strong>performance key</strong> authenticates the request in the header. No Google authorization, OAuth, or Tag Manager is involved.
          </p>
          <pre className="site-performance-key__example">{exampleCommand}</pre>
          <div className="site-performance-key__actions">
            <Button variant="secondary" size="sm" onClick={() => copyPerformanceExample(exampleCommand)}>
              <Icon name={performanceExampleCopied ? 'check' : 'copy'} size={13} />
              {performanceExampleCopied ? 'Copied' : 'Copy curl example'}
            </Button>
            <Link to="/performance" className="btn btn--ghost btn--sm">Open Performance</Link>
          </div>
        </div>

        {newPerformanceKey && (
          <div className="site-performance-key__new">
            <div>
              <strong>Copy this new key now</strong>
              <span className="muted small">The full value is shown only after creation and will not be listed again.</span>
            </div>
            <div className="site-performance-key__value">
              <code>{newPerformanceKey.value}</code>
              <Button variant="ghost" size="sm" onClick={copyPerformanceKey}>
                <Icon name={performanceKeyCopied ? 'check' : 'copy'} size={13} />
                {performanceKeyCopied ? 'Copied' : 'Copy key'}
              </Button>
            </div>
          </div>
        )}

        <div className="site-performance-key__list">
          <div className="site-performance-key__list-head">
            <strong>Created keys</strong>
            <span className="muted small">Only the first and last 4 characters are listed.</span>
          </div>
          {performanceKeys.length > 0 ? (
            <div className="site-performance-key__rows">
              {performanceKeys.map((key) => (
                <div className="site-performance-key__row" key={key.id}>
                  <code>{key.key_hint}</code>
                  <span className="muted small">
                    Created {fmtTime(key.created_at)} · {key.last_used_at ? `Last used ${fmtTime(key.last_used_at)}` : 'Not used yet'}
                  </span>
                  {isAdmin && (
                    <Button variant="dangerGhost" size="sm" onClick={() => removePerformanceKey(key)}>
                      <Icon name="trash" size={13} />
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small site-performance-key__note">No backend keys have been created yet.</p>
          )}
        </div>
      </Card>

      <SnippetCard site={site} origin={location.origin} title="Installation snippet" />
    </>
  );
}
