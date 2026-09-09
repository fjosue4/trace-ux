import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Site } from '../../api';
import { spring } from '../../lib/motion';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { Icon } from '../ui/Icon';
import './SnippetCard.css';

type Props = {
  site: Site;
  origin: string;
  title?: string;
  /** When provided, the card can be dismissed (transient banners). */
  onDismiss?: () => void;
  /** Render without the outer card when the snippet is hosted in a modal. */
  embedded?: boolean;
  /** Optional action for the post-create modal. */
  onConfigureSite?: () => void;
};

type InstallMethod = 'manual' | 'gtm';

export default function SnippetCard({ site, origin, title, onDismiss, embedded = false, onConfigureSite }: Props) {
  const [method, setMethod] = useState<InstallMethod>('manual');
  const [copied, setCopied] = useState(false);

  const manual = `<script async src="${origin}/t.js" data-site="${site.site_key}"></script>`;

  // GTM's script injection drops unknown attributes like data-site, so the
  // tag manager variant sets it programmatically after creating the element.
  const gtm = `<script>
  (function () {
    var s = document.createElement('script');
    s.async = true;
    s.src = '${origin}/t.js';
    s.setAttribute('data-site', '${site.site_key}');
    document.head.appendChild(s);
  })();
</script>`;

  const code = method === 'manual' ? manual : gtm;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const content = (
    <>
      {!embedded && (
        <div className="row row--between">
          <h3>{title ?? `${site.name} is ready`}</h3>
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}

      <div className="snippet-tabs" role="tablist" aria-label="Installation method">
        <motion.button
          type="button"
          role="tab"
          aria-selected={method === 'manual'}
          className={`snippet-tab${method === 'manual' ? ' is-active' : ''}`}
          onClick={() => setMethod('manual')}
          whileTap={{ scale: 0.96 }}
          transition={spring}
        >
          Manual
        </motion.button>
        <motion.button
          type="button"
          role="tab"
          aria-selected={method === 'gtm'}
          className={`snippet-tab${method === 'gtm' ? ' is-active' : ''}`}
          onClick={() => setMethod('gtm')}
          whileTap={{ scale: 0.96 }}
          transition={spring}
        >
          Google Tag Manager
        </motion.button>
      </div>

      {method === 'manual' ? (
        <p className="muted small">
          Paste this into the <code>{'<head>'}</code> of every page on your site:
        </p>
      ) : (
        <p className="muted small">
          In GTM: <strong>Tags → New → Custom HTML</strong>, paste this, set the trigger to{' '}
          <strong>All Pages</strong> and publish. It builds the tag with{' '}
          <code>setAttribute</code> because GTM drops the plain <code>data-site</code> attribute
          when injecting scripts.
        </p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.pre key={method} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>{code}</motion.pre>
      </AnimatePresence>

      <Button variant="secondary" size="sm" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />
        {copied ? 'Copied' : 'Copy snippet'}
      </Button>
      {embedded && (onConfigureSite || onDismiss) && (
        <div className="snippet-card__actions">
          {onConfigureSite && (
            <Button variant="secondary" size="sm" onClick={onConfigureSite}>
              <Icon name="settings" size={13} />
              Configure Site
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Close
            </Button>
          )}
        </div>
      )}
    </>
  );

  return embedded ? (
    <div className="snippet-card snippet-card--embedded">{content}</div>
  ) : (
    <Card className="snippet-card">{content}</Card>
  );
}
