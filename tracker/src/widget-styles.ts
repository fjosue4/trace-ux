// Styles for the unified widget. Kept in its own module so the markup in
// widget.ts stays readable. Everything is scoped to the widget's shadow root
// and driven by tokens the dashboard resolves server-side, so the widget picks
// up a site's branding without inheriting anything from the host page.
export function widgetCSS(): string {
  return `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.root {
  --w-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, system-ui, sans-serif;
  --w-line: color-mix(in srgb, var(--w-panel-text) 11%, transparent);
  --w-line-soft: color-mix(in srgb, var(--w-panel-text) 7%, transparent);
  --w-muted: color-mix(in srgb, var(--w-panel-text) 58%, transparent);
  --w-quiet: color-mix(in srgb, var(--w-panel-text) 42%, transparent);
  --w-hover: color-mix(in srgb, var(--w-panel-text) 5%, transparent);
  --w-field: color-mix(in srgb, var(--w-panel-text) 3%, transparent);
  font-family: var(--w-font);
  -webkit-font-smoothing: antialiased;
}

/* ---- launcher ---- */
.launcher {
  position: fixed; z-index: 2147483000;
  bottom: var(--w-space); right: var(--w-space);
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 44px; padding: 0 18px 0 15px;
  border: 0; border-radius: 999px;
  background: var(--w-button-bg); color: var(--w-button-text);
  font-family: var(--w-font); font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0,0,0,.16), 0 8px 24px -6px rgba(0,0,0,.28);
  will-change: transform;
}
.launcher:focus-visible { outline: 2px solid var(--w-button-bg); outline-offset: 3px; }
.launcher__icon { display: grid; place-items: center; width: 20px; height: 20px; flex: none; }
.launcher__icon svg { width: 20px; height: 20px; display: block; }
.launcher__badge {
  display: grid; place-items: center; flex: none;
  min-width: 20px; height: 20px; padding: 0 6px; margin-inline-start: 2px;
  border-radius: 999px;
  background: var(--w-button-text); color: var(--w-button-bg);
  font-size: 11px; font-weight: 700; line-height: 1;
  /* Two reasons a centred digit still reads off-centre, both handled here.
     Vertically, place-items centres the line box, and the font box reserves
     descender space a digit never uses, landing the glyph ~0.06em low; the
     bottom padding trims twice that back off. Horizontally, tabular figures
     pad a narrow glyph like "1" asymmetrically inside a fixed advance, so
     they are left off — min-width already stops the width jumping between
     counts, and a badge has no column to align to. */
  padding-bottom: 0.12em;
}

/* A site that uploaded its own mark gets an icon-only launcher: the image is
   the button. Whatever resolution was uploaded is rendered at 48x48. */
.launcher--icon {
  width: 48px; height: 48px; padding: 0;
  border-radius: 50%; overflow: visible;
}
.launcher--icon .launcher__icon { width: 48px; height: 48px; border-radius: 50%; overflow: hidden; }
.launcher--icon .launcher__icon img { width: 48px; height: 48px; object-fit: cover; display: block; }
.launcher--icon .launcher__icon svg { width: 22px; height: 22px; }
.launcher--icon .launcher__badge {
  position: absolute; top: -3px; right: -2px; margin: 0;
  min-width: 19px; height: 19px; padding: 0 5px 0.12em;
  border: 2px solid var(--w-panel-bg);
  background: var(--w-accent); color: #fff;
  font-size: 10.5px;
}

/* The launcher and the panel are position: fixed, so they anchor to the
   viewport rather than to .root. Physical insets, flipped by a class: a
   logical inset would resolve against each box's own direction, which is
   always ltr here, and would never move the widget. */
.root--left .launcher,
.root--left .panel { right: auto; left: var(--w-space); }

/* ---- panel ---- */
.panel {
  position: fixed; z-index: 2147483001;
  bottom: calc(var(--w-space) + 56px); right: var(--w-space);
  display: flex; flex-direction: column;
  width: min(var(--w-max-width), calc(100vw - 2 * var(--w-space)));
  max-height: min(660px, calc(100vh - var(--w-space) * 2 - 72px));
  background: var(--w-panel-bg); color: var(--w-panel-text);
  border: 1px solid var(--w-line);
  border-radius: var(--w-radius);
  box-shadow: 0 1px 2px rgba(0,0,0,.10), 0 24px 56px -12px rgba(0,0,0,.30);
  overflow: hidden;
  overscroll-behavior: contain;
  will-change: transform, opacity;
}
.panel__head {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 16px 14px 20px;
  border-bottom: 1px solid var(--w-line-soft);
  flex: none;
}
.panel__title {
  margin: 0; flex: 1; min-width: 0;
  font-size: 15px; font-weight: 650; letter-spacing: -0.015em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.icon-btn {
  display: grid; place-items: center; flex: none;
  width: 30px; height: 30px; padding: 0;
  border: 1px solid var(--w-line); border-radius: 8px;
  background: transparent; color: var(--w-muted);
  cursor: pointer; transition: background-color .14s ease, color .14s ease;
}
.icon-btn:hover { background: var(--w-hover); color: var(--w-panel-text); }
.icon-btn:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
.icon-btn svg { width: 15px; height: 15px; display: block; }

/* ---- tabs ---- */
.tabs { position: relative; display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--w-line-soft); flex: none; }
.tab {
  position: relative; appearance: none;
  padding: 11px 12px 12px; border: 0; background: transparent;
  color: var(--w-muted); font-family: var(--w-font); font-size: 13px; font-weight: 600;
  letter-spacing: -0.01em; cursor: pointer; transition: color .16s ease;
}
.tab:hover { color: var(--w-panel-text); }
.tab[aria-selected='true'] { color: var(--w-panel-text); }
.tab:focus-visible { outline: 2px solid var(--w-accent); outline-offset: -2px; border-radius: 6px; }
.tab__count {
  display: inline-grid; place-items: center;
  min-width: 17px; height: 17px; padding: 0 5px; margin-inline-start: 6px;
  border-radius: 999px; background: var(--w-accent); color: #fff;
  font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums;
  vertical-align: 1px;
}
.tabs__marker {
  position: absolute; bottom: -1px; left: 0; height: 2px;
  border-radius: 2px 2px 0 0; background: var(--w-accent);
  will-change: transform, width;
}

/* ---- scroll body ---- */
/* overflow-x is clipped because view swaps animate along X: without this the
   incoming view briefly overflows and the panel flashes a horizontal
   scrollbar mid-transition. */
.body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
.body::-webkit-scrollbar { width: 10px; }
.body::-webkit-scrollbar-thumb { background: var(--w-line); border: 3px solid var(--w-panel-bg); border-radius: 999px; }
.body--ticket-thread { display: flex; flex-direction: column; height: 0; overflow: hidden; }
.body--ticket-thread > .ticket-view--thread { flex: 1; min-height: 0; }
.view { will-change: transform, opacity; }

/* ---- announcements list ---- */
.item {
  display: block; width: 100%; text-align: start;
  padding: 15px 20px; border: 0; border-bottom: 1px solid var(--w-line-soft);
  background: transparent; color: inherit; font-family: var(--w-font);
  cursor: pointer; transition: background-color .14s ease;
}
.item:last-child { border-bottom: 0; }
.item:hover { background: var(--w-hover); }
/* The toast's open button reuses .item with its padding zeroed (the toast
   wrapper already supplies it), so the inherited hover fill would hug the
   text with no breathing room. */
.detail > .item:hover { background: transparent; }
.item:focus-visible { outline: 2px solid var(--w-accent); outline-offset: -2px; }
.item__top { display: flex; align-items: center; gap: 8px; }
.eyebrow {
  color: var(--w-accent); font-size: 10.5px; font-weight: 750;
  text-transform: uppercase; letter-spacing: .07em;
}
.item__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--w-accent); flex: none; }
.item__title { margin: 6px 0 0; font-size: 14.5px; font-weight: 620; line-height: 1.35; letter-spacing: -0.012em; }
.item__excerpt {
  margin: 5px 0 0; font-size: 13px; line-height: 1.5; color: var(--w-muted);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.item__meta { display: flex; gap: 12px; margin-top: 9px; font-size: 11.5px; color: var(--w-quiet); }
.item__meta span { display: inline-flex; align-items: center; gap: 4px; }
.item__meta svg { width: 12px; height: 12px; }

/* ---- detail ---- */
.detail { padding: 18px 20px 22px; }
.back {
  display: inline-flex; align-items: center; gap: 5px;
  margin-bottom: 14px; padding: 6px 10px 6px 7px;
  border: 1px solid var(--w-line); border-radius: 8px;
  background: transparent; color: var(--w-muted);
  font-family: var(--w-font); font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: background-color .14s ease, color .14s ease;
}
.back:hover { background: var(--w-hover); color: var(--w-panel-text); }
.back:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
.back svg { width: 13px; height: 13px; }
.detail__title { margin: 8px 0 0; font-size: 18px; font-weight: 680; line-height: 1.28; letter-spacing: -0.02em; }
.detail__body { margin: 12px 0 0; font-size: 13.5px; line-height: 1.62; color: var(--w-muted); white-space: pre-wrap; }
.detail__link {
  display: inline-flex; align-items: center; gap: 5px; margin-top: 14px;
  color: var(--w-accent); font-size: 13px; font-weight: 620; text-decoration: none;
  white-space: nowrap;
}
.detail__link svg { flex: none; width: 13px; height: 13px; }
.detail__link:hover { text-decoration: underline; }
.detail__actions { display: flex; align-items: center; gap: 8px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--w-line-soft); }
.like {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border: 1px solid var(--w-line); border-radius: 999px;
  background: transparent; color: var(--w-panel-text);
  font-family: var(--w-font); font-size: 13px; font-weight: 620; cursor: pointer;
  transition: background-color .14s ease, border-color .14s ease, color .14s ease;
}
.like:hover { background: var(--w-hover); }
.like:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
.like.on { background: var(--w-accent); border-color: var(--w-accent); color: #fff; }
.like svg { width: 14px; height: 14px; }
.like__heart { will-change: transform; }

/* ---- comment composer ---- */
.composer { display: flex; gap: 8px; margin-top: 14px; }
.field {
  flex: 1; min-width: 0; height: 38px; padding: 0 12px;
  border: 1px solid var(--w-line); border-radius: 9px;
  background: var(--w-field); color: var(--w-panel-text);
  font-family: var(--w-font); font-size: 13px;
  transition: border-color .14s ease, box-shadow .14s ease;
}
.field::placeholder { color: var(--w-quiet); }
.field:focus { outline: 0; border-color: var(--w-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--w-accent) 18%, transparent); }
.send {
  flex: none; height: 38px; padding: 0 15px; border: 0; border-radius: 9px;
  background: var(--w-accent); color: #fff;
  font-family: var(--w-font); font-size: 13px; font-weight: 620; cursor: pointer;
  transition: filter .14s ease;
}
.send:hover { filter: brightness(1.08); }
.send:disabled { opacity: .45; cursor: default; }
.send:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }

/* ---- support tickets ----------------------------------------------------- */
.ticket-view { min-height: 100%; }
.ticket-item { padding-top: 14px; padding-bottom: 14px; }
.ticket-item__subject { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 620; }
.ticket-status {
  display: inline-flex; align-items: center; flex: none; min-height: 20px; padding: 2px 7px;
  border: 1px solid var(--w-line); border-radius: 999px; color: var(--w-muted);
  font-size: 10px; font-weight: 700; line-height: 1.2; white-space: nowrap;
}
.ticket-status--open, .ticket-status--in_progress { border-color: color-mix(in srgb, var(--w-accent) 38%, var(--w-line)); color: var(--w-accent); }
.ticket-status--under_review { color: #c06b24; border-color: color-mix(in srgb, #c06b24 35%, var(--w-line)); }
.ticket-status--closed { opacity: .72; }
.ticket-footer { padding: 14px 20px 18px; border-top: 1px solid var(--w-line-soft); }
.ticket-footer .submit, .ticket-empty .submit { margin-top: 12px; }
.ticket-empty .submit { width: auto; padding: 0 18px; }
.ticket-thread { padding: 18px 20px 22px; }
.ticket-view--thread { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
.ticket-view--thread .ticket-thread { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
.ticket-view--thread .ticket-thread > .back,
.ticket-view--thread .ticket-thread__heading,
.ticket-view--thread .ticket-thread > .detail__title,
.ticket-view--thread .ticket-thread__meta,
.ticket-view--thread .ticket-composer,
.ticket-view--thread .ticket-closed { flex: 0 0 auto; }
.ticket-thread > .back { margin-bottom: 15px; }
.ticket-thread__heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ticket-thread .detail__title { margin-top: 8px; }
.ticket-thread__meta { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-top: 9px; color: var(--w-quiet); font-size: 11px; }
.ticket-thread__meta .detail__link { margin-top: 0; font-size: 11px; }
.ticket-messages {
  display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 9px; margin-top: 20px;
  overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: none;
}
.ticket-messages::-webkit-scrollbar { display: none; width: 0; height: 0; }
.ticket-message { max-width: 88%; padding: 10px 12px; border: 1px solid var(--w-line); border-radius: 13px; background: var(--w-field); }
.ticket-message--visitor { align-self: flex-end; border-bottom-right-radius: 4px; }
.ticket-message--staff { align-self: flex-start; border-bottom-left-radius: 4px; background: var(--w-hover); }
.ticket-message__author { color: var(--w-muted); font-size: 10px; font-weight: 700; }
.ticket-message__body { margin: 4px 0 0; color: var(--w-panel-text); font-size: 13px; line-height: 1.52; white-space: pre-wrap; overflow-wrap: anywhere; }
.ticket-message__time { margin-top: 6px; color: var(--w-quiet); font-size: 10px; }
.ticket-composer { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--w-line-soft); }
.ticket-composer__input { height: 82px; resize: none; }
.ticket-composer__actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.ticket-composer__actions .submit { width: auto; min-width: 0; margin-inline-start: 0; padding: 0 12px; }
.ticket-error { margin-top: 10px; padding: 9px 11px; border-radius: 8px; background: color-mix(in srgb, #d0453e 12%, transparent); color: #d0453e; font-size: 11.5px; line-height: 1.4; }
.ticket-composer__actions .ticket-error { flex: 1; margin-top: 0; }
.ticket-loading { padding: 40px 0; color: var(--w-muted); text-align: center; font-size: 13px; }
.ticket-closed { margin-top: 20px; padding: 11px 12px; border: 1px solid var(--w-line); border-radius: 9px; color: var(--w-muted); font-size: 12px; text-align: center; }
.ticket-new { padding: 20px; }
.ticket-new__intro { margin: 8px 0 20px; color: var(--w-muted); font-size: 13px; line-height: 1.5; }
.ticket-new__field { display: block; margin-top: 14px; }
.ticket-new__field > span { display: block; margin-bottom: 7px; color: var(--w-panel-text); font-size: 12px; font-weight: 620; }
.ticket-new__field .field { width: 100%; }
.ticket-new__message { height: 115px; resize: none; }
.ticket-new > .submit { margin-top: 16px; }

/* ---- feedback form ---- */
.form { padding: 20px; }
.form__intro { margin: 0 0 18px; font-size: 14px; font-weight: 620; line-height: 1.4; letter-spacing: -0.012em; }
.q { margin-bottom: 18px; }
.q:last-of-type { margin-bottom: 20px; }
.q__label { margin-bottom: 9px; font-size: 12.5px; font-weight: 620; color: var(--w-panel-text); }
.q.invalid .q__label { color: #d0453e; }
.q.invalid .field, .q.invalid textarea { border-color: #d0453e; }
.stars { display: flex; gap: 4px; }
.stars button {
  flex: 1; padding: 4px 0; border: 0; background: none; cursor: pointer;
  font-size: 26px; line-height: 1;
  color: color-mix(in srgb, var(--w-panel-text) 16%, transparent);
  transition: color .14s ease; will-change: transform;
}
.stars button:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; border-radius: 6px; }
.stars button.on { color: var(--w-accent); }
.nps { display: flex; gap: 4px; }
.nps button {
  flex: 1; padding: 8px 0; border: 1px solid var(--w-line); border-radius: 7px;
  background: transparent; color: var(--w-panel-text);
  font-family: var(--w-font); font-size: 12.5px; font-variant-numeric: tabular-nums; cursor: pointer;
  transition: background-color .14s ease, color .14s ease, border-color .14s ease;
}
.nps button:hover { background: var(--w-hover); }
.nps button.on { background: var(--w-accent); border-color: var(--w-accent); color: #fff; font-weight: 650; }
.nps button:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 1px; }
.choices { display: flex; flex-wrap: wrap; gap: 6px; }
.choices button {
  padding: 8px 14px; border: 1px solid var(--w-line); border-radius: 999px;
  background: transparent; color: var(--w-panel-text);
  font-family: var(--w-font); font-size: 12.5px; cursor: pointer;
  transition: background-color .14s ease, color .14s ease, border-color .14s ease;
}
.choices button:hover { background: var(--w-hover); }
.choices button.on { background: var(--w-accent); border-color: var(--w-accent); color: #fff; font-weight: 620; }
.choices button:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
textarea {
  width: 100%; height: 76px; resize: none; padding: 10px 12px;
  border: 1px solid var(--w-line); border-radius: 9px;
  background: var(--w-field); color: var(--w-panel-text);
  font-family: var(--w-font); font-size: 13px; line-height: 1.5;
  transition: border-color .14s ease, box-shadow .14s ease;
}
textarea::placeholder { color: var(--w-quiet); }
textarea:focus { outline: 0; border-color: var(--w-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--w-accent) 18%, transparent); }
.submit {
  width: 100%; height: 42px; border: 0; border-radius: 10px;
  background: var(--w-accent); color: #fff;
  font-family: var(--w-font); font-size: 14px; font-weight: 640; cursor: pointer;
  transition: filter .14s ease; will-change: transform;
}
.submit:hover { filter: brightness(1.08); }
.submit:disabled { opacity: .45; cursor: default; }
.submit:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }

/* ---- states ---- */
.done { padding: 44px 24px; text-align: center; }
.done__mark {
  display: grid; place-items: center; width: 46px; height: 46px; margin: 0 auto 14px;
  border-radius: 50%; background: color-mix(in srgb, var(--w-accent) 14%, transparent);
  color: var(--w-accent); will-change: transform;
}
.done__mark svg { width: 22px; height: 22px; }
.done__title { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.012em; }
.done__note { margin: 6px 0 0; font-size: 13px; color: var(--w-muted); }
.empty { padding: 52px 28px; text-align: center; }
.empty__mark { display: grid; place-items: center; width: 44px; height: 44px; margin: 0 auto 14px; border-radius: 12px; background: var(--w-hover); color: var(--w-quiet); }
.empty__mark svg { width: 20px; height: 20px; }
.empty__title { margin: 0; font-size: 14px; font-weight: 620; }
.empty__note { margin: 5px 0 0; font-size: 13px; color: var(--w-muted); line-height: 1.5; }
.inline-note {
  margin-top: 12px; padding: 10px 13px; border-radius: 9px;
  background: color-mix(in srgb, var(--w-accent) 11%, transparent);
  color: var(--w-panel-text); font-size: 12.5px; font-weight: 600; text-align: center;
}
[hidden] { display: none !important; }

/* ---- small screens ---- */
@media (max-width: 560px) {
  .root .panel,
  .root--left .panel {
    left: var(--w-space); right: var(--w-space); bottom: var(--w-space);
    width: auto; max-width: none; max-height: min(86vh, calc(100vh - var(--w-space) * 2));
  }
}
`;
}
