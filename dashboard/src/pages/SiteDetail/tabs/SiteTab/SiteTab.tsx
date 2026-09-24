import Card from '../../../../components/ui/Card';
import Button from '../../../../components/ui/Button';
import FloatingSave from '../../../../components/ui/FloatingSave';
import Notice from '../../../../components/ui/Notice';
import { Icon } from '../../../../components/ui/Icon';
import { Field, Input } from '../../../../components/ui/fields';
import SnippetCard from '../../../../components/sites/SnippetCard';
import { useSiteDetails } from './hooks/useSiteDetails';
import { SiteTabProps } from './SiteTab.types';

export function SiteTab({ id, site, isAdmin, onDetailChanged }: SiteTabProps) {
  const { name, url, editName, editUrl, dirty, saving, save, reset, error: detailsError } =
    useSiteDetails(id, { name: site.name, url: site.url }, onDetailChanged);

  return (
    <>
      <Card className="site-details">
        <form
          className="site-details__form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="site-url__info">
            <strong>
              <Icon name="globe" size={13} /> Site details
            </strong>
            <span className="muted small">
              The name is how this site is labelled across the dashboard. Recordings are only
              accepted from the URL’s origin — update it if the site moves.
            </span>
          </div>

          {isAdmin ? (
            <>
              <div className="site-details__fields">
                <Field label="Site name">
                  <Input
                    value={name}
                    onChange={(e) => editName(e.target.value)}
                    placeholder="Reply Pro"
                    maxLength={100}
                  />
                </Field>
                <Field label="Site URL">
                  <Input
                    value={url}
                    onChange={(e) => editUrl(e.target.value)}
                    placeholder="https://your-site.com"
                    inputMode="url"
                  />
                </Field>
              </div>
              {detailsError && <Notice tone="error">{detailsError}</Notice>}
              {dirty && (
                <div className="site-details__actions">
                  <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={saving}>
                    Discard changes
                  </Button>
                </div>
              )}
              <FloatingSave visible={dirty} busy={saving} onSave={save} />
            </>
          ) : (
            <dl className="site-details__readonly">
              <div>
                <dt className="muted small">Site name</dt>
                <dd className="small">{site.name}</dd>
              </div>
              <div>
                <dt className="muted small">Site URL</dt>
                <dd className="small">{site.url || '\u2014'}</dd>
              </div>
            </dl>
          )}
        </form>
      </Card>

      <SnippetCard site={site} origin={location.origin} title="Installation snippet" />
    </>
  );
}
