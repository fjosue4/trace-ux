import { useState } from 'react';
import { Site } from '../../api';
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
};

export default function SnippetCard({ site, origin, title, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script async src="${origin}/t.js" data-site="${site.site_key}"></script>`;

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="snippet-card">
      <div className="row row--between">
        <h3>{title ?? `${site.name} is ready`}</h3>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
      <p className="muted small">
        Paste this snippet into the <code>{'<head>'}</code> of every page on your site:
      </p>
      <pre>{snippet}</pre>
      <Button variant="secondary" size="sm" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />
        {copied ? 'Copied' : 'Copy snippet'}
      </Button>
    </Card>
  );
}
