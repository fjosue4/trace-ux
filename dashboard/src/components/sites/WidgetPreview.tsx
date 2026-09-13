import type { CSSProperties } from 'react';
import type { SiteSettings } from '../../api';
import { Icon } from '../ui/Icon';
import './WidgetPreview.css';

type Props = {
  draft: SiteSettings;
  iconUrl?: string;
  /** Launcher label to show when the operator has not chosen one. */
  launcherPlaceholder: string;
};

type PreviewSection = 'updates' | 'tickets' | 'feedback';

// What the visitor actually sees, rendered straight from the unsaved draft.
// Every control in the Widget tab is represented here so changing a setting
// updates the preview on the same render — no save or page refresh is needed.
export default function WidgetPreview({ draft, iconUrl, launcherPlaceholder }: Props) {
  const configured = draft.updates_appearance ?? {};
  const legacy = draft.appearance ?? {};
  const theme = configured.theme ?? 'light';
  const left = (draft.widget_position ?? 'right') === 'left';
  const accent = configured.accent || legacy.accent || legacy.primary || '#2f7d4a';
  const panelBg = configured.panel_bg || legacy.panel_bg || (theme === 'dark' ? '#121b16' : '#ffffff');
  const panelText = configured.panel_text || legacy.panel_text || (theme === 'dark' ? '#eef5f0' : '#142018');
  const buttonBg = configured.button_bg || legacy.button_bg || accent;
  const buttonText = configured.button_text || legacy.button_text || '#ffffff';
  const radius = configured.radius || legacy.radius || 18;
  const maxWidth = configured.max_width || 440;

  const sections = ([
    draft.updates_enabled && { id: 'updates' as const, label: "What's new" },
    draft.tickets_enabled && { id: 'tickets' as const, label: 'Support' },
    draft.feedback_enabled && { id: 'feedback' as const, label: 'Feedback' },
  ].filter(Boolean) as { id: PreviewSection; label: string }[]);
  const shown = sections[0]?.id;
  const visible = draft.widget_enabled ?? sections.length > 0;
  const hidden = !visible || sections.length === 0;
  const label = configured.button_label || legacy.button_label || launcherPlaceholder;

  return (
    <div
      className={`widget-preview is-${theme}${left ? ' is-left' : ' is-right'}${hidden ? ' is-hidden' : ''}`}
      style={
        {
          '--preview-accent': accent,
          '--preview-radius': `${radius}px`,
          '--preview-max-width': `${maxWidth}px`,
          '--preview-panel-bg': panelBg,
          '--preview-panel-text': panelText,
          '--preview-button-bg': buttonBg,
          '--preview-button-text': buttonText,
        } as CSSProperties
      }
    >
      <div className="widget-preview__label">Live preview</div>

      <div className="widget-preview__stage" aria-hidden={hidden}>
        <div className="widget-preview__panel">
          <header>
            <strong>Help &amp; updates</strong>
            <button type="button" aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </header>

          {sections.length > 1 && (
            <nav className="widget-preview__tabs" aria-label="Widget sections">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={section.id === shown ? 'is-active' : undefined}
                  tabIndex={-1}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          )}

          <main>
            {shown === 'updates' && (
              <>
                <span className="widget-preview__eyebrow">NEW RELEASE</span>
                <h3>Everything you need, closer at hand</h3>
                <p>We refreshed the workspace with faster navigation and a clearer way to discover what’s new.</p>
                <button type="button" className="widget-preview__cta">
                  <Icon name="star" size={13} /> Like · 12
                </button>
              </>
            )}

            {shown === 'feedback' && (
              <>
                <h3>{draft.survey_title || 'How was your experience?'}</h3>
                <div className="widget-preview__rating">
                  {draft.survey_type === 'nps'
                    ? [0, 1, 2, 3, 4, 5].map((n) => <i key={n}>{n}</i>)
                    : [1, 2, 3, 4, 5].map((n) => <Icon key={n} name="star" size={18} />)}
                </div>
                <div className="widget-preview__field">Tell us more…</div>
                <button type="button" className="widget-preview__cta">Send feedback</button>
              </>
            )}

            {shown === 'tickets' && (
              <>
                <span className="widget-preview__eyebrow">SUPPORT</span>
                <h3>How can we help?</h3>
                <p>Start a conversation with your support team and keep the whole thread in one place.</p>
                <button type="button" className="widget-preview__cta">Open a ticket</button>
              </>
            )}

            {!shown && <p>No sections are switched on.</p>}
          </main>
        </div>

        {iconUrl ? (
          <div className="widget-preview__launcher widget-preview__launcher--icon">
            <img src={iconUrl} alt="" />
          </div>
        ) : (
          <div className="widget-preview__launcher">
            {label} <b>1</b>
          </div>
        )}
      </div>

      {hidden && (
        <div className="widget-preview__off">
          {visible ? 'No sections switched on' : 'Hidden on this site'}
        </div>
      )}
    </div>
  );
}
