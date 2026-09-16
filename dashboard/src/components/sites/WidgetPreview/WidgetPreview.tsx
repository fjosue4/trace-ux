import classNames from 'classnames';
import { Icon } from '../../ui/Icon';
import { useWidgetPreview } from './hooks/useWidgetPreview';
import { WidgetPreviewProps } from './WidgetPreview.types';
import './WidgetPreview.scss';

// What the visitor actually sees, rendered straight from the unsaved draft.
// Every control in the Widget tab is represented here so changing a setting
// updates the preview on the same render — no save or page refresh is needed.
export default function WidgetPreview({ draft, iconUrl, launcherPlaceholder }: WidgetPreviewProps) {
  const { theme, left, middle, sections, shown, visible, hidden, label, style } = useWidgetPreview({ draft, launcherPlaceholder });

  return (
    <div
      className={classNames('widget-preview', `is-${theme}`, left ? 'is-left' : 'is-right', { 'is-hidden': hidden, 'is-middle': middle })}
      style={style}
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
