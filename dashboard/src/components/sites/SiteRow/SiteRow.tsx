import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { fmtDate, stripProto } from '../../../lib/format';
import { softSpring } from '../../../lib/motion';
import { Icon } from '../../ui/Icon';
import { useSiteRow } from './hooks/useSiteRow';
import { SiteRowProps } from './SiteRow.types';
import './SiteRow.scss';

// Which optional features a site has not turned on yet, in setup order.
function missingSetup(site: SiteRowProps['site']): string[] {
  const s = site.settings;
  const widgetOn = s?.widget_enabled ?? Boolean(s?.updates_enabled || s?.tickets_enabled || s?.feedback_enabled);
  return [
    ['Recording', site.recording_enabled !== false],
    ['Widget', widgetOn],
    ['Logs', Boolean(s?.logs?.enabled)],
  ]
    .filter(([, on]) => !on)
    .map(([label]) => label as string);
}

// One row of the sites table. The whole row opens the site; the buttons on
// the right act without leaving the list.
export default function SiteRow({ site, origin, live, index, canDelete, onDelete }: SiteRowProps) {
  const navigate = useNavigate();
  const { snippetCopied, copyText, setSnippetCopied } = useSiteRow();
  const snippet = `<script async src="${origin}/t.js" data-site="${site.site_key}"></script>`;
  const sitePath = `/sites/site/${site.id}`;
  const missing = missingSetup(site);
  const recording = site.recording_enabled !== false;

  const status = !recording
    ? { label: 'Recording off', className: 'site-row__status--warn', detail: 'Visits are not recorded' }
    : site.session_count === 0
      ? { label: 'Waiting for data', className: 'site-row__status--muted', detail: 'Install the snippet to start' }
      : live && live > 0
        ? { label: 'Receiving', className: '', detail: <span className="site-row__live">{live} live now</span> }
        : { label: 'Receiving', className: '', detail: 'No one on the site right now' };

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <motion.tr
      className="site-row is-clickable"
      onClick={() => navigate(sitePath)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...softSpring, delay: index * 0.03 }}
    >
      <td className="col-nowrap site-row__site">
        <Link to={sitePath} className="site-row__name" onClick={stop}>{site.name}</Link>
        <span className="cell-stack__sub site-row__url">{stripProto(site.url)}</span>
      </td>
      <td className="col-nowrap site-row__status">
        <div className="cell-stack">
          <span className={`cell-stack__main ${status.className}`}>{status.label}</span>
          <span className="cell-stack__sub">{status.detail}</span>
        </div>
      </td>
      <td className="col-nowrap col-end site-row__count">
        <div className="cell-stack">
          <span className="cell-stack__main site-row__num">{site.session_count.toLocaleString()}</span>
          <span className="cell-stack__sub">{site.session_count === 1 ? 'session' : 'sessions'}</span>
        </div>
      </td>
      <td className="col-nowrap site-row__setup">
        {missing.length === 0 ? (
          <span className="cell-stack__sub site-row__complete">Complete</span>
        ) : (
          <div className="cell-stack">
            <span className="cell-stack__main site-row__missing">{missing.join(', ')}</span>
            <span className="cell-stack__sub">not enabled</span>
          </div>
        )}
      </td>
      <td className="col-nowrap site-row__added">
        <div className="cell-stack">
          <span className="cell-stack__main site-row__plain">{fmtDate(site.created_at)}</span>
          <span className="cell-stack__sub">added</span>
        </div>
      </td>
      <td className="col-fit site-row__action-cell" onClick={stop}>
        <div className="site-row__actions">
          <button
            type="button"
            className={`icon-btn${snippetCopied ? ' is-success' : ''}`}
            onClick={() => copyText(snippet, setSnippetCopied)}
            aria-label="Copy snippet"
            title={snippetCopied ? 'Snippet copied' : `Copy snippet · key ${site.site_key}`}
          >
            <Icon name={snippetCopied ? 'check' : 'code'} size={15} />
          </button>
          <Link to={`/sessions?site=${site.id}`} className="btn btn--secondary btn--sm">
            Sessions
            <Icon name="arrowRight" size={13} />
          </Link>
          <Link to={sitePath} className="icon-btn" aria-label={`Manage ${site.name}`} title="Manage site">
            <Icon name="settings" size={15} />
          </Link>
          {canDelete && (
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              onClick={() => onDelete(site)}
              aria-label={`Delete ${site.name}`}
              title="Delete site"
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </td>
    </motion.tr>
  );
}
