# Product Updates & Feedback — Feature Plan

## Goal

Build a lightweight, Sleekplan-inspired product update experience inside the existing TraceUX tracker widget. Teams should be able to publish release announcements, surface them to visitors, and collect lightweight feedback without adding the rest of Sleekplan's product suite.

The feature should also modernize the existing feedback widget so both experiences feel like one polished, responsive product surface.

## Product scope

### In scope for the MVP

- A per-site announcement feed for published product updates.
- Admin workflow to create, edit, publish, unpublish, archive, and delete announcements.
- Announcement fields: title, short summary, body, version or release label, optional link, and publish date.
- A shared tracker launcher for Feedback and Updates.
- An unread indicator when a new update is available.
- Announcement detail view with a like reaction and comments.
- Anonymous visitor participation, with existing TraceUX identity available when it is already provided.
- Dashboard counts for views/read state, reactions, and comments.
- Admin comment deletion/moderation.
- Responsive sizing for desktop, tablet, and mobile layouts.

### Out of scope

- Roadmaps, feature-request boards, public voting, or prioritization.
- Email, push, or Slack notifications.
- Audience segmentation, scheduling rules, or targeting by visitor attributes.
- Multiple reaction types beyond a simple like.
- Full rich-text authoring, attachments, or image hosting.
- A separate public status page or a full analytics suite.

## User experience

### Visitor flow

1. A visitor loads a site with the TraceUX tracker installed.
2. The tracker loads the widget configuration and the site's published updates.
3. The launcher shows Feedback, Updates, or both depending on configuration.
4. A new published update adds an unread badge to the launcher.
5. The visitor opens Updates, scans the feed, and opens an announcement.
6. Opening an announcement marks it as read locally and through the API when possible.
7. The visitor can like the update and add a comment without leaving the site.
8. The widget preserves the visitor's reaction and read state on later visits.

When only Feedback is enabled, existing sites retain the current feedback-only behavior. When Updates is enabled as well, the widget uses a shared shell with clear tabs or sections rather than creating two competing floating buttons.

### Admin flow

1. An admin opens the Updates area and selects a site.
2. The admin creates a draft announcement.
3. The admin previews the announcement at desktop and mobile widths.
4. The admin publishes it; only published announcements are exposed to the tracker.
5. The admin can review engagement counts and remove inappropriate comments.
6. The admin can unpublish or archive an announcement without deleting its engagement data.

Viewers can read announcement data and engagement summaries but cannot publish, edit, archive, or moderate content.

## Visual and interaction direction

The widget should be modern, clean, and professional while remaining visually quiet on the host site.

- Use TraceUX design tokens for typography, color, borders, radius, spacing, and elevation.
- Keep the launcher compact with a clear label and a subtle unread dot or count.
- Use a consistent panel header, close action, section tabs, and empty/loading/error states.
- Use short animations for opening, closing, tab changes, and reaction feedback; respect `prefers-reduced-motion`.
- Use a desktop popover with a responsive width and a mobile bottom sheet or near-full-screen panel.
- Keep the content area scrollable while the header and primary actions remain easy to reach.
- Provide visible focus states, keyboard support, semantic labels, and sufficient color contrast.
- Keep the widget inside the existing Shadow DOM boundary so host-page CSS cannot break it.

Recommended sizing behavior:

- Desktop width: `clamp(300px, 34vw, 440px)`.
- Available width: never exceed `calc(100vw - 24px)`.
- Desktop height: cap the panel around `min(700px, 78vh)`.
- Mobile: use almost the full viewport width with safe-area padding and a bottom-sheet layout.
- Content density: support compact and comfortable spacing through configuration rather than separate components.

## Technical design

### Existing integration points

- `tracker/src/main.ts` owns the cross-site widget and already renders it in Shadow DOM.
- `GET /api/config/{siteKey}` supplies per-site tracker configuration.
- `POST /api/ingest/{siteKey}` accepts lightweight feedback events linked to a session.
- `dashboard/src/pages/Feedback.tsx` and `dashboard/src/pages/Feedback.css` provide the existing feedback management pattern.
- `dashboard/src/components/layout/Sidebar.tsx` and `dashboard/src/main.tsx` define dashboard navigation and routes.
- `server/store.go` owns SQLite migrations and persistence.
- `server/api.go` registers authenticated dashboard routes and public tracker-facing routes.

### Data model

Add a migration with the following site-scoped records:

#### `announcements`

- `id`
- `site_id` with cascade delete
- `title`
- `summary`
- `body`
- `release_label`
- `link_url`
- `status`: `draft`, `published`, or `archived`
- `published_at`
- `created_at`
- `updated_at`

#### `announcement_reactions`

- `announcement_id`
- `visitor_key` (a site-scoped, opaque browser identifier)
- `reaction`: `like`
- `created_at`
- Unique constraint on `(announcement_id, visitor_key)`

#### `announcement_comments`

- `id`
- `announcement_id`
- `visitor_key`
- Optional existing TraceUX identity fields where available
- `body`
- `status`: `visible` or `hidden`
- `created_at`

#### `announcement_reads`

- `announcement_id`
- `visitor_key`
- `read_at`
- Unique constraint on `(announcement_id, visitor_key)`

Use an opaque random browser identifier stored in site-scoped local storage for anonymous read/reaction state. Do not introduce a new requirement for email or other personally identifiable information. Reuse the current session and identity context only where it already exists.

### API surface

Authenticated dashboard endpoints:

- `GET /api/announcements?site_id=...`
- `POST /api/announcements`
- `GET /api/announcements/{id}`
- `PATCH /api/announcements/{id}`
- `DELETE /api/announcements/{id}`
- `POST /api/announcements/{id}/publish`
- `POST /api/announcements/{id}/archive`
- `GET /api/announcements/{id}/engagement`
- `GET /api/announcements/{id}/comments`
- `DELETE /api/announcements/comments/{id}`

Public tracker endpoints:

- `GET /api/updates/{siteKey}` — published announcements only, with aggregate counts and the caller's reaction/read state when supplied.
- `POST /api/updates/{siteKey}/{id}/reaction` — create or remove the visitor's like.
- `POST /api/updates/{siteKey}/{id}/comments` — add a bounded comment.
- `POST /api/updates/{siteKey}/{id}/read` — record read state.

Public endpoints must be site-scoped, CORS-allowlisted using the registered site URL, rate-limited, and protected by strict payload length and field validation. Draft and archived content must never be returned by public routes.

### Tracker configuration

Extend the per-site settings/configuration with an updates section, for example:

- `updates_enabled`
- `updates_position`
- `updates_button_label`
- `updates_size`: `compact` or `comfortable`
- `updates_max_width` within a safe server-defined range

The existing feedback appearance settings should be promoted into shared widget appearance where possible, while preserving the current fields for compatibility. The server should continue to own all configuration defaults and validation.

### Dashboard UI

Add an `Updates` page and navigation item. The page should include:

- Site selector.
- Draft and published filters.
- Announcement list with status, publish date, reactions, comments, and unread/view counts.
- Create/edit form in a modal or side panel.
- Preview mode using the same visual component as the tracker widget.
- Publish, unpublish, archive, and delete actions with confirmation for destructive actions.
- Comment review state and admin deletion.

Keep the existing Feedback page functional. Shared dashboard primitives should be used for cards, buttons, notices, modal behavior, and empty states.

### Tracker UI structure

Refactor the current feedback-only widget into small internal pieces rather than duplicating markup:

- `EngagementLauncher`
- `EngagementPanel`
- `FeedbackView`
- `UpdatesView`
- `AnnouncementCard`
- `AnnouncementDetail`
- `CommentComposer`

The public tracker remains a single bundled script. The widget should fail safely: if updates cannot load, feedback must continue to work, and a host-site network or rendering error must never interrupt tracking.

## Delivery phases

### Phase 1 — Product and design foundation

- Confirm site-scoped announcements for the MVP.
- Confirm whether announcement body content is plain text or a small sanitized Markdown subset.
- Define empty, loading, error, unread, liked, comment, and archived states.
- Define responsive breakpoints, maximum sizes, and appearance tokens.
- Create the shared widget component contract before changing the existing feedback markup.

### Phase 2 — Persistence and server APIs

- Add SQLite migration and indexes.
- Implement announcement CRUD and lifecycle operations.
- Implement reactions, comments, read state, and aggregate engagement queries.
- Add public update routes, CORS coverage, validation, and rate limits.
- Add server tests for authorization, site isolation, lifecycle visibility, duplicate reactions, and moderation.

### Phase 3 — Dashboard management

- Add typed API helpers and announcement data types.
- Add the Updates route and sidebar item.
- Build the list, editor, preview, lifecycle actions, and comment moderation.
- Restrict mutations to admins and keep viewer access read-only.

### Phase 4 — Tracker widget refresh

- Extract the shared responsive widget shell.
- Modernize Feedback without changing its submission contract.
- Add Updates feed, detail view, reactions, comments, unread state, and read state.
- Extend tracker config fetching and public endpoint handling.
- Verify that feedback continues to work when updates are disabled, unavailable, or empty.

### Phase 5 — Hardening and rollout

- Run Go tests and frontend typechecks/builds.
- Test desktop, tablet, narrow mobile, dark/light host sites, long titles, long comments, and no-data states.
- Verify keyboard and screen-reader behavior.
- Check CORS, rate limits, payload limits, authorization, and XSS-safe rendering.
- Release behind a per-site `updates_enabled` flag and enable it on a test site first.

## Acceptance criteria

- An admin can create a draft, preview it, publish it, unpublish it, archive it, and delete it.
- A published update appears only on the intended site's tracker widget.
- Draft and archived updates are never exposed through public tracker APIs.
- A new update produces an unread indicator for visitors who have not read it.
- Visitors can read an update, like/unlike it, and submit a comment without leaving the host site.
- A visitor cannot create multiple active likes for the same announcement.
- Admins can see engagement counts and remove comments; viewers cannot mutate announcements or comments.
- Existing feedback submission, configuration, and dashboard behavior remain compatible.
- The widget adapts to available viewport width and height without clipping or horizontal overflow.
- The mobile layout remains usable at narrow widths and supports safe-area insets.
- Accessibility and reduced-motion behavior are supported.
- Public endpoints enforce site isolation, origin checks, rate limits, and bounded input.
- If update APIs fail, the feedback widget and tracker recording continue to function.

## Success measures

- Announcement open rate among visitors who see the unread indicator.
- Percentage of opened announcements receiving a like or comment.
- Comment submission success rate and moderation volume.
- Feedback widget completion rate after the visual refresh.
- No measurable increase in tracker initialization failures or page errors.

## Follow-up opportunities

- Release categories and tags.
- Multiple reaction types.
- Scheduled publishing.
- Announcement targeting by site section or audience.
- Email or external notification integrations.
- A public changelog page.
- Connecting announcement engagement with Performance and session replay data.
