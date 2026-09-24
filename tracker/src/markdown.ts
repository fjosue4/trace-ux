import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';

const allowedTags = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'img',
  'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'ul',
];

function escapeHTML(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLink(raw: string) {
  try {
    const url = new URL(raw, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const renderer = new Renderer();

// Raw HTML is displayed as text. Announcement Markdown never gets an HTML
// escape hatch into the host application.
renderer.html = ({ text }) => escapeHTML(text);

renderer.image = ({ href, title, text }) => {
  const safe = safeLink(href);
  if (!safe) return escapeHTML(text);
  const titleAttribute = title ? ` title="${escapeHTML(title)}"` : '';
  return `<img src="${escapeHTML(safe)}" alt="${escapeHTML(text)}" loading="lazy" referrerpolicy="no-referrer"${titleAttribute}>`;
};

renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  const safe = safeLink(href);
  if (!safe) return label;
  const titleAttribute = title ? ` title="${escapeHTML(title)}"` : '';
  return `<a href="${escapeHTML(safe)}" target="_blank" rel="noopener noreferrer"${titleAttribute}>${label}</a>`;
};

const markdown = new Marked({
  breaks: true,
  gfm: true,
  renderer,
});

export function renderMarkdownHTML(source: string) {
  const parsed = String(markdown.parse(source || ''));
  return DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['alt', 'class', 'href', 'loading', 'referrerpolicy', 'rel', 'src', 'target', 'title'],
  });
}

export function markdownToPlainText(source: string) {
  if (!source) return '';
  const template = document.createElement('template');
  template.innerHTML = renderMarkdownHTML(source);
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}
