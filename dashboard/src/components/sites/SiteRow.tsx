import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Site } from '../../api';
import { fmtTime } from '../../lib/format';
import Button from '../ui/Button';
import { Icon } from '../ui/Icon';
import './SiteRow.css';

type Props = {
  site: Site;
  origin: string;
  onDelete: (site: Site) => void; // opens the confirmation in the parent page
};

// One row of the sites list: identity + key, stats, and quick actions —
// including one-click snippet copy.
export default function SiteRow({ site, origin, onDelete }: Props) {
  const [keyCopied, setKeyCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const snippet = `<script async src="${origin}/t.js" data-site="${site.site_key}"></script>`;

  async function copyText(text: string, mark: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    mark(true);
    setTimeout(() => mark(false), 1500);
  }

  return (
    <div className="site-row">
      <span className="site-row__icon" aria-hidden>
        <Icon name="globe" size={18} />
      </span>

      <div className="site-row__main">
        <Link to={`/site/${site.id}`} className="site-row__name" title="Manage this site">
          {site.name}
        </Link>
        <span className="site-row__key">
          <span className="mono">{site.site_key}</span>
          <button
            className={`icon-btn${keyCopied ? ' is-success' : ''}`}
            onClick={() => copyText(site.site_key, setKeyCopied)}
            aria-label="Copy site key"
            title={keyCopied ? 'Copied' : 'Copy site key'}
          >
            <Icon name={keyCopied ? 'check' : 'copy'} size={13} />
          </button>
        </span>
      </div>

      <div className="site-row__stats">
        <span className="site-stat" title="Recorded sessions">
          <Icon name="film" size={14} />
          <strong>{site.session_count}</strong>
          {site.session_count === 1 ? 'session' : 'sessions'}
        </span>
        <span className="site-stat muted" title="Tracking since">
          <Icon name="clock" size={14} />
          {fmtTime(site.created_at)}
        </span>
      </div>

      <div className="site-row__actions">
        <button
          className={`icon-btn${snippetCopied ? ' is-success' : ''}`}
          onClick={() => copyText(snippet, setSnippetCopied)}
          aria-label="Copy snippet"
          title={snippetCopied ? 'Snippet copied' : 'Copy snippet'}
        >
          <Icon name={snippetCopied ? 'check' : 'code'} size={15} />
        </button>
        <Link to={`/sessions?site=${site.id}`} className="btn btn--secondary btn--sm">
          <Icon name="play" size={12} />
          Sessions
        </Link>
        <Button variant="dangerGhost" size="sm" onClick={() => onDelete(site)}>
          <Icon name="trash" size={13} />
          Delete
        </Button>
      </div>
    </div>
  );
}
