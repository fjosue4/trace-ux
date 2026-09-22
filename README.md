# TraceUX

[![npm](https://img.shields.io/npm/v/@trace-ux/tracker?label=%40trace-ux%2Ftracker&color=2f7d4a)](https://www.npmjs.com/package/@trace-ux/tracker)
[![Live demo](https://img.shields.io/badge/live%20demo-trace--ux.builtbyfrank.dev-2f7d4a)](https://trace-ux.builtbyfrank.dev/)
[![License](https://img.shields.io/badge/license-Community%20Source-6b786f)](LICENSE)

The complete UX bundle for products that want to understand, hear, and update their users.

Self-hosted session replay, in-product feedback, and announcements with
per-release reactions and comments — in one small binary, on your server, with
an experience you control.

## **Try TraceUX live:** [Open the Live Demo →](https://trace-ux.builtbyfrank.dev/)

TraceUX closes the loop between what users do, what they say, and what you ship:
watch a real visit, ask for feedback in context, publish an update, and see the
reaction to that update. No separate replay vendor, survey tool, changelog
service, or analytics warehouse required.

With Smartlook shutting down, TraceUX provides a self-hosted path for teams
that need product insight without handing their data to another hosted
analytics platform. It records how real visitors use your site (DOM event
streams, not video), stores them on **your own server**, and brings replay,
feedback, and announcements into one dashboard. One binary, one SQLite file,
one Docker container.

> **Current bundle:** session replay, in-app feedback, public announcements,
> per-announcement reads/reactions/comments, browser logs, backend performance
> percentiles, multi-user access, and a unified visitor widget.

**Live landing page:** [trace-ux.builtbyfrank.dev](https://trace-ux.builtbyfrank.dev)

## The complete UX bundle

TraceUX gives a small product team one practical loop instead of four
disconnected tools:

| Capability | What it answers |
| --- | --- |
| **Session replay** | What did the visitor actually do, and where did the journey break? |
| **In-product feedback** | What did the visitor think at that exact moment? |
| **Announcements** | What do we need to tell users about the product? |
| **Per-announcement feedback** | Did users read, like, or comment on this specific update? |
| **Logs & performance** | What browser and backend signals explain the experience? |

All of these surfaces are organized by site in the dashboard. The tracker
ships one unified **Help & updates** launcher: visitors can open **What's new**
or **Feedback** without juggling separate widgets, and each response can be
connected back to the session that produced it.

## Why

With Smartlook shutting down, many teams are looking for a replacement that
offers a familiar session-replay workflow while keeping data under their
control. Existing self-hosted options are often heavy: full analytics suites
that need 8 GB+ RAM, multi-service Docker stacks, or paid plugins. TraceUX is
built for **a tiny VPS**: a single static binary (~20 MB, ~30 MB RAM) with
SQLite and the dashboard embedded. Backups are copying one folder.

## Screenshots

### Sessions dashboard

<img width="1895" height="891" alt="image" src="https://github.com/user-attachments/assets/6fff39bc-22ba-4cb0-835c-445e337c0f85" />

### Session replay

<img width="1901" height="886" alt="image" src="https://github.com/user-attachments/assets/85811ddb-4f22-4f20-8cc4-be2ae6cc885f" />

## Quickstart

**Docker** (recommended):

```bash
mkdir trace-ux && cd trace-ux
docker run -d --name trace-ux -p 127.0.0.1:8080:8080 -v "$PWD/data:/data" \
  -e TRACE_UX_PASSWORD=change-me ghcr.io/fjosue4/trace-ux:latest
```

Or with docker-compose (optional Caddy TLS included):

```bash
cd deploy && TRACE_UX_PASSWORD=change-me docker compose up -d
```

**Single binary** (any Linux/macOS, amd64/arm64):

```bash
TRACE_UX_PASSWORD=change-me TRACE_UX_SECURE_COOKIES=0 ./trace-ux # local HTTP development only
```

Then:

1. Put the dashboard behind HTTPS (the Compose example binds the backend to loopback for this purpose), then open your HTTPS URL and sign in. Leave the username empty (or type `admin`) and use `TRACE_UX_PASSWORD` — that's the bootstrap **admin** account.
2. **Add site** → copy the snippet (the card has a **Manual** and a **Google Tag Manager** tab):

   ```html
   <script async src="https://your-server/t.js" data-site="YOUR_SITE_KEY"></script>
   ```

3. **Manual:** paste it into the `<head>` of every page on your site.
   **Google Tag Manager:** create a *Custom HTML* tag with the snippet from the GTM tab (it sets `data-site` via `setAttribute`, because GTM's script injection drops the attribute), trigger it on *All Pages* and publish.

   Sessions start appearing within seconds. The same tracker powers the
   unified **Help & updates** launcher: enable Feedback and Announcements from
   the site's dashboard settings, then publish an announcement or collect a
   response without changing the snippet.

### npm and React integrations

For applications that prefer code over a script tag, install the tracker
package — [**@trace-ux/tracker** on npm](https://www.npmjs.com/package/@trace-ux/tracker).
The server origin is required because npm/React integrations do not have a
script URL from which to infer it:

```bash
npm install @trace-ux/tracker
```

```ts
import { init } from '@trace-ux/tracker';

const traceux = init({
  siteKey: 'YOUR_SITE_KEY',
  origin: 'https://your-server.example.com',
  userId: currentUser?.id,
  widget: true, // toggle in dashboard
  onAnnouncement: (announcement) => {
    // Full title, summary, body, release label, link and metadata are available.
    console.log('New announcement:', announcement.title, announcement.body);
    console.log('Version metadata:', announcement.internal_headers?.current_version);
  },
});

traceux.identify({ userId: user.id }); // after login
traceux.track('checkout_completed');
traceux.setUserStatus('active');
traceux.warn('Checkout request failed', { orderId });

// Flush and stop recording when the host application owns the lifecycle.
traceux.stop();
```

The package entry has no import-time side effects. `widget: true` opts into the
optional widget's dynamic import; the widget is fetched only when the server
configuration enables at least one section. `onAnnouncement` runs when a newly
published or edited published announcement reaches the widget, with the full
announcement payload, including any `internal_headers` key/value metadata
configured by the admin. Those headers are not rendered in the visitor widget,
but they are delivered to the browser callback, so they must not contain
secrets. It is not replayed for announcements already present during the
widget's initial load. `warn`, `error`, `info`, and
`debug` send application logs when Logs is enabled for the site and its
severity threshold permits them. `setUserStatus` records a seekable
`user_status` activity; it does not create a separate server-side user table.

**The script and GTM snippets pass `widget: true` for you; npm and React do
not.** That is the whole reason the Help & updates widget can appear via GTM and
not via npm with the same site key — a bundle that never uses the widget should
not pay to download it. The check is `options.widget !== true`, so it must be
exactly `true`; other truthy values are ignored.

React applications can use the optional provider and hook:

```tsx
import { TraceUXProvider, useTraceUX } from '@trace-ux/tracker/react';

function Checkout() {
  const traceux = useTraceUX();
  return <button onClick={() => traceux.track('checkout_started')}>Checkout</button>;
}

export function App() {
  return (
    <TraceUXProvider siteKey="YOUR_SITE_KEY" origin="https://your-server.example.com" widget>
      <Checkout />
    </TraceUXProvider>
  );
}
```

The same package also keeps the existing HTML and Google Tag Manager IIFE
installation unchanged. If an npm/React integration and `/t.js` happen to be
present on one page, the first initialized tracker owns the page and the other
path reuses that handle rather than recording a second session.

## Install on a VPS (one script)

On any Linux server with systemd, one line installs everything — the binary ships with the dashboard and tracker embedded, so there is nothing else to set up:

```bash
curl -fsSL https://raw.githubusercontent.com/fjosue4/trace-ux/main/install.sh | sudo bash
```

The script: downloads the prebuilt release for your architecture (checksum-verified), creates a locked-down system user, puts recordings in `/var/lib/trace-ux`, generates an admin password, installs a systemd service (auto-start on boot, auto-restart on crash), and adds a `trace-ux` control command. Re-running it upgrades in place and keeps data and users.

Then manage the server with:

| Command | What it does |
| --- | --- |
| `trace-ux --status` | is it running? |
| `trace-ux --start` / `--stop` / `--restart` | control the service |
| `trace-ux --logs` | last 100 log lines (`journalctl -u trace-ux -f` to follow) |
| `trace-ux --password '<new>'` | set a new admin password (revokes old admin logins) — **single-quote it**, see below |
| `trace-ux --update` | upgrade to the latest release |
| `trace-ux --uninstall` | remove it (recordings are kept) |
| `trace-ux --run` | run in the foreground for debugging |

### First login

The installer generates the admin password and writes it to the env file rather
than printing it. Read it from there:

```bash
sudo grep '^TRACE_UX_PASSWORD=' /etc/trace-ux/trace-ux.env
```

Sign in as `admin` with that value, then change it:

```bash
sudo trace-ux --password 'your-new-password'
```

**Single-quote the password.** Passwords worth using contain characters the
shell interprets before TraceUX ever sees them. `!` triggers history expansion
in an interactive bash session, so an unquoted `Pa!ss` either expands to
something else or fails outright with `event not found` — and you end up locked
out by a password you never chose. `$`, `` ` `` and `\` are substituted too.
Double quotes do **not** stop any of this; only single quotes do.

Two follow-ups worth knowing: the password is passed as a command argument, so
it lands in your shell history and is briefly visible in `ps` — clear the
history entry on a shared machine. And `--password` revokes every existing admin
login, so other sessions are signed out immediately.

Building from a git clone instead of a release: `sudo bash install.sh --build-from-source` (needs Go ≥ 1.27 and Node ≥ 18). Releases are built automatically by [.github/workflows/release.yml](.github/workflows/release.yml) when a `v*` tag is pushed.

## Releases and updates

TraceUX publishes versioned Linux releases for `amd64` and `arm64`. Each
release bundles the dashboard and tracker into the server binary and publishes
the architecture archives with a `checksums.txt` file. Release installs do not
need Go, Node, or Docker on the VPS.

To update an existing release install to the latest published version:

```bash
sudo trace-ux --update
trace-ux --version
sudo trace-ux --status
```

The update downloads the matching release for the server architecture,
verifies it against the published checksum, replaces the binary, and restarts
the systemd service. Your SQLite data, sites, users, and admin password stay in
place. Check `/api/health` after the restart if the instance is behind a proxy.

To install a specific release instead of the latest one, pin the version when
running the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/fjosue4/trace-ux/main/install.sh \
  | sudo env TRACE_UX_VERSION=0.3.0 bash
```

Installs created with `--build-from-source` do not use `--update`; pull the
desired source revision and run `sudo bash install.sh --build-from-source`
again.

## Minimum requirements

TraceUX is deliberately built for the smallest VPS you can rent:

| Resource | Minimum | Comfortable |
| --- | --- | --- |
| CPU | 1 vCore | 2 vCores |
| RAM | 512 MB (server idles at ~30–50 MB) | 1 GB |
| Disk | 1 GB | 10 GB+ (recordings ≈ 60 KB per typical session; the SQLite file is the whole store) |
| OS | Linux amd64/arm64 with systemd — Debian 11+, Ubuntu 20.04+, Rocky/Alma 9+, Fedora | any of those |
| Network | one open TCP port (8080 by default) | + Caddy/nginx for HTTPS |

No external database, no queue, no other services — SQLite lives in `/var/lib/trace-ux` and backups are copying that folder. Docker is the alternative route (`deploy/docker-compose.yml`) if you prefer containers; the container runs the same binary. In practice: a $4–6/mo VPS handles a handful of sites with thousands of monthly sessions.

## Configuration

| Env var            | Default   | Meaning                                              |
| ------------------ | --------- | ---------------------------------------------------- |
| `TRACE_UX_PASSWORD`      | —         | Required to create the first admin account             |
| `TRACE_UX_RESET_ADMIN`   | —         | `1` = re-point `admin` at `TRACE_UX_PASSWORD` on boot |
| `TRACE_UX_DATA`          | `./data`  | Data dir (SQLite db, users, auth secret)              |
| `TRACE_UX_ADDR`          | `:8080`   | Listen address                                        |
| `TRACE_UX_SECURE_COOKIES`| `1`       | Set `0` only for local HTTP development               |
| `TRACE_UX_TRUSTED_PROXIES`| —        | Comma-separated proxy CIDRs allowed to supply XFF      |
| `TRACE_UX_RETENTION_DAYS`| `90`      | Auto-delete sessions older than this                  |
| `TRACE_UX_MAX_GB_DISK`   | — *(no limit)* | Disk budget in GB; over it, oldest recordings are deleted |
| `TRACE_UX_MAX_EVENT_MB`  | `4`       | Ceiling on one rrweb event; raise it if replays are blank |
| `TRACE_UX_CHECKOUT_INTERVAL_MS` | `30000` | How often rrweb re-snapshots the DOM — the main storage lever |
| `TRACE_UX_INLINE_STYLESHEET` | `1` | Copy page CSS into every snapshot. `0` shrinks snapshots but replays load CSS cross-origin |
| `TRACE_UX_SLIM_DOM`      | `1`       | Drop comments, `<script>`, favicons and social meta from snapshots |
| `TRACE_UX_SPACE_FLOOR_DAYS`| `3`     | The budget never deletes recordings newer than this   |
| `TRACE_UX_DEMO_REPLAY`  | `0`       | Enable short-lived public demo replay links            |
| `TRACE_UX_DEMO_REPLAY_TTL` | `900`  | Demo replay lifetime in seconds (60–3600)             |
| `TRACE_UX_DEV_STATIC`    | —         | Dev only: serve frontend builds from disk             |
| `TRACE_UX_PUBLIC_URL`    | —         | Public `http(s)` origin used in Slack links            |
| `TRACE_UX_SLACK_SIGNING_SECRET` | — | Optional fallback Slack app signing secret; the System health UI is preferred |

### Snapshot size and cadence

Two variables govern how much a recording costs. Both default to the values that
were previously hardcoded, so an existing install behaves identically until you
change one.

`TRACE_UX_MAX_EVENT_MB` caps a single rrweb event. The FullSnapshot — the whole
serialized DOM with stylesheets inlined — is by far the largest, and a heavy app
can exceed the 4 MB default. When it does, that snapshot is refused while the
incremental events around it are accepted, and the replay scrubs normally while
rendering nothing at all. The 400 names the actual size, so the number to set
comes straight out of the error:

```
{"error":"event is too large: 5011782 bytes, limit 4194304 (raise TRACE_UX_MAX_EVENT_MB)"}
```

The request ceiling is derived from this, not configured separately: a batch
carries a snapshot plus the incrementals buffered with it, so raising the event
cap raises the body limit with it.

`TRACE_UX_CHECKOUT_INTERVAL_MS` is how often rrweb re-snapshots the page, and it
is the dominant term in storage — at the 30s default a nine-hour session stores
roughly 1,080 complete copies of the DOM, stylesheets and all. Raising it to
120s or 300s cuts disk close to linearly. The cost is seek latency: jumping to
an arbitrary point in a replay may have to apply more diffs. Playback from the
start is unaffected. Accepted range is 5,000–3,600,000 ms.

If your CSS bundle is large, note that it is inlined into *every* snapshot —
shrinking the bundle and raising the interval multiply together.

`TRACE_UX_INLINE_STYLESHEET` controls that inlining. It defaults to on, matching
rrweb. Turning it off makes snapshots dramatically smaller, but the replay must
then load your stylesheets from the recorded origin, which the replay page's own
`style-src 'self'` CSP blocks — so replays come back unstyled. The server stores
each distinct stylesheet once regardless, so leaving this on is usually the
right trade.

`TRACE_UX_SLIM_DOM` drops content a replay never needs: comments, `<script>`
tags (they do not execute during playback), favicons, and social, robots and
verification meta tags. On by default, worth a fraction of a percent, and
harmless.

### Disk budget

`TRACE_UX_RETENTION_DAYS` bounds recordings by age. `TRACE_UX_MAX_GB_DISK`
bounds them by size, as a backstop for when traffic outruns the retention
window: once the data directory exceeds the budget, the oldest sessions are
deleted until it is back under, checked every 10 minutes.

**It is unset by default, and unset means no limit** — so upgrading changes
nothing until you opt in. `0` means no limit too, so the variable can sit in an
env file switched off rather than being commented out. A value that is not a
plain number (`25GB`, say) is refused with a warning at startup rather than
being read as "no limit", because an operator who wrote it believes the disk is
capped.

`TRACE_UX_SPACE_FLOOR_DAYS` is a floor the budget cannot cross. If the store is
still over budget with nothing older than the floor, it stops and logs that the
budget is too small for the traffic, rather than deleting recordings the day
they arrive.

**The budget needs `auto_vacuum=incremental`, which SQLite only accepts on a
database with no tables yet.** Recordings are BLOBs inside `trace_ux.db`, so
deleting them returns pages to SQLite's freelist but does not shrink the file --
without incremental auto-vacuum a sweep would destroy recordings and hand the
filesystem nothing back. Databases created by current versions get it
automatically. On one created earlier, the sweep refuses to delete anything and
logs why; run a full `VACUUM` to convert it.

Each site opens to a tabbed hub: **Overview** keeps the latest recordings,
logs, feedback, and summary counts together; **Site** manages the registered
URL, installation snippet, and backend performance connection; **Recordings**,
**Feedback**, **Announcements**, **Widget**, and **Logs** keep each part of the
bundle easy to configure without one long scrolling form.

## Users & access

The dashboard supports real accounts; the **admin** (the `TRACE_UX_PASSWORD` account) manages them alone, under **Settings → Team** (hidden from viewers):

- **Roles** — `admin` can manage users and sites; `viewer` can browse sites, sessions and replays. Both can change their own password under **Settings**.
- **Creating users** — pick a username and a password (min 8 characters); the user signs in with it directly. No email, no invites.
- **Revocation is immediate** — resetting a password, changing a role, or deleting a user signs that person out everywhere. Changing your own password keeps your current tab signed in.
- **Passwords** are stored as salted PBKDF2-SHA256 hashes (210k iterations); login cookies are random tokens stored only as hashes, so a leaked DB can't be replayed.
- **Locked out?** Restart with `TRACE_UX_RESET_ADMIN=1` to re-point the `admin` account at the current `TRACE_UX_PASSWORD` (all previous admin logins are revoked), then remove the flag.

`TRACE_UX_PASSWORD` only seeds the bootstrap admin the first time. After that, passwords live in the database and changing the env var has no effect.

## Tracking visitors & events

The snippet takes identity at init, and the page can attach or change it later — for example when a visitor logs in mid-recording:

```html
<script async src="https://your-server/t.js" data-site="KEY"
        data-user-id="u-42" data-client-id="acme" data-remote-id="remote-7"></script>
<script>
  // any time during the session (latest non-empty value wins):
  window.TraceUX.identify({ userId: 'u-42', clientId: 'acme', remoteId: 'remote-7' });
</script>
```

Sessions are filterable by any of the three ids with the **Visitor** filter in the dashboard, and ids show on the replay page.

### Identifying a visitor who logs in mid-session

Recording starts the moment the tracker initializes, before anyone has logged
in. Calling `identify()` later attaches the visitor to **the whole session,
including everything recorded before the call** — you do not lose the anonymous
part of the journey that led up to the login.

That is not a backfill pass; identity is stored on the session row rather than
on individual events, so there is only ever one value to set:

```ts
const traceux = init({ siteKey: 'KEY', origin: 'https://your-server' });
// ...visitor browses anonymously; this is all being recorded...
traceux.identify({ userId: user.id, clientId: user.accountId }); // after login
```

`init()` returns immediately and queues calls made before the tracker has
finished starting, so there is nothing to await — calling `identify()` on the
next line is safe. If the visitor is already known at page load, pass `userId` /
`clientId` / `remoteId` straight to `init()` instead.

In React, `TraceUXProvider` does this for you: identity props that change after
login are forwarded through `identify()` without starting a second recorder.

```tsx
import { TraceUXProvider, useTraceUX } from '@trace-ux/tracker/react';
```

**Logging out does not un-identify the session.** Only non-empty values are
applied, so `identify({ userId: '' })` is a no-op rather than a reset. On a
shared device this matters: if a second person logs in on the same tab, their id
overwrites the session's, and the first person's activity is re-attributed to
them. End the session explicitly instead:

```ts
traceux.stop();
sessionStorage.removeItem('trace_ux_sid'); // next init() starts a fresh session
```

Mark any element to appear as seekable activity in the replay sidebar:

```html
<button trace-ux-track-id="checkout-click">Buy now</button>
```

or programmatically: `window.TraceUX.track('checkout-click')`. Clicking an activity row jumps the recording to that exact moment.

Ask for a Slack notification alongside the event (see the site's **Integrations** tab in the dashboard) by adding `notify: true`:

```ts
traceux.track('checkout_error', 'checkout-button', {
  notify: true,
  details: { pathname: location.pathname, errorInfo: 'Payment failed' },
});
```

`details` is stored with the custom event and included in the Slack message.
`traceux.info(event, details)` is a separate browser log and does not attach
details to the custom event. The wrapper should pass the details through the
third argument:

```ts
tracker.track(event, trackId, { ...options, details });
```

```html
<button trace-ux-track-id="checkout-button" trace-ux-track-notify="true">Buy now</button>
```

This is independent of the browser-log matcher: it fires whenever the call or click sets `notify`, with no pattern to configure. An admin still has to enable **Custom events** and configure its webhook from that site's **Integrations** tab for anything to be sent. Server CPU, RAM, and disk alerts are configured under **System health**.

Slack buttons also send an interaction callback even when they open a URL. Set
the Slack app's **Interactivity & Shortcuts → Request URL** to:

```text
https://YOUR_TRACEUX_HOST/api/integrations/slack/interactions
```

Save the Slack app's **Signing Secret** under **System health → Slack system
alerts**, below the Request URL. It is encrypted at rest and the dashboard
shows only its last four characters. `TRACE_UX_SLACK_SIGNING_SECRET` remains
an optional fallback for older deployments; a secret saved in the UI takes
precedence. The endpoint verifies Slack's signature and immediately returns
HTTP 200; the button's URL continues opening the linked ticket or replay. Do
not use the incoming webhook URL as the Request URL.

Masking: all form inputs are masked by default; any element carrying `trace-ux-mask` — as a class or as a bare attribute — has its text masked, and `trace-ux-block` (class) removes the element from the recording entirely.

### Logs

Logs can be enabled per site from the site's **Logs** configuration. Select any combination of the four levels — debug, info, warnings, and errors — and only those exact levels are stored (for example, info and errors without warnings). Browser rows stay linked to the visitor's recording session. The dashboard's unified **Logs** page opens in a live view of the last 15 minutes, refreshes every 5 seconds, and shows up to 1,000 browser and service rows together. It supports site, service, environment, severity, preset time-window, and custom time filters. Search can target the message, structured `extra` data, or both.

Add backend or external producers from a site's **Services** tab. Each service receives its own generated `tux_log_…` API key, shown in full only when it is created or rotated. Keys are stored as hashes and can be revoked independently. A service inherits the site's selected severity levels by default or can override them. Environment belongs to each event, so the same service key can report from staging and production:

```bash
curl -X POST "https://your-server/api/logs/ingest" \
  -H "Content-Type: application/json" \
  -H "X-TraceUX-Log-Key: YOUR_SERVICE_KEY" \
  -d '{"logs":[{
    "severity":"error",
    "message":"Payment request failed",
    "environment":"production",
    "extra":{"request_id":"req_123","status_code":502}
  }]}'
```

`Authorization: Bearer YOUR_SERVICE_KEY` is also accepted. `extra` may be any valid JSON value up to 64 KiB and is displayed as expandable formatted JSON. A request may contain up to 1,000 log entries.

Log storage has two independent per-site caps: 15 days by default and 1,000,000 rows by default. The oldest rows are removed during the regular retention sweep; either cap can be changed or disabled from the same Logs configuration. Browser logs are also removed automatically when their related recording is removed, while service logs remain independent of recordings. Browser logs are not yet shown inside the replay timeline.

Because browser console output can contain sensitive values, enable this only when the site's logging policy allows it. TraceUX stores a bounded, formatted message rather than raw console argument objects.

### Performance

The **Performance** page shows backend endpoint latency as p50, p95 and p99, with request counts, error rate, a latency trend, and filters for site, environment, service and version. Metrics are stored as minute-level histograms so the dashboard stays small while retaining useful slow-tail measurements.

To connect a backend, open a site and choose **Site → Backend performance → Create key**. The key belongs in the application server that measures request duration; it is not used by the browser tracking snippet and does not instrument backend code by itself. Store the raw value as a backend secret, then send observations to the server over HTTPS — no Google account, OAuth, or Tag Manager is required:

```bash
curl -X POST "https://your-server/api/performance/ingest/YOUR_SITE_KEY" \
  -H "Content-Type: application/json" \
  -H "X-TraceUX-Performance-Key: YOUR_BACKEND_KEY" \
  -d '{"observations":[
    {"environment":"production","service":"api","version":"1.4.0","endpoint":"GET /orders","duration_ms":184,"status_code":200}
  ]}'
```

The backend integration is intentionally server-to-server. The site key identifies the site in the URL; the performance key authenticates the request in `X-TraceUX-Performance-Key` (or `Authorization: Bearer`). TraceUX stores only a hash of each performance key. The full value is shown only at creation, while the Site tab lists active keys using only their first and last four characters. Administrators can create multiple keys and remove them individually. The current endpoint is the stable ingestion contract for the upcoming language-specific backend agent.

## Feedback & surveys

Collect feedback from visitors right on your tracked sites — each response is
linked to the session recording, so you can watch the moment behind the score.
Feedback and announcements share one visitor-facing launcher, so listening and
communicating feel like one product surface instead of two unrelated widgets.

**Everything is configured per site from the dashboard** (open a site from the Sites list): toggle recordings on/off, enable the widget, pick its corner, set the survey id/title, and choose the question set — built-in stars (1–5), NPS (0–10), or **fully custom questions** (rating, choice, or text; required or optional). The tracker picks the configuration up automatically from the server; the snippet carries no settings.

**Or collect programmatically:**

```js
window.TraceUX.feedback({ rating: 5, comment: 'Loved it', surveyId: 'checkout' });
```

Responses land in the dashboard's **Feedback** page (per-survey summaries, comments, device info, one-click jump into the replay). Each site's hub page shows the latest 5 recordings, the latest 5 feedback responses, and the overall positive-feedback percentage. Admins can delete individual responses (e.g. spam).

Turning **recordings off** for a site stops the capture of visitor event streams server-side — the feedback widget and lightweight session metadata keep working.

## Announcements and per-release feedback

Publish product communication without sending visitors to a separate changelog:

- **Draft, preview, publish, and archive** announcements from the dashboard.
- Add a release label, short summary, detailed body, and an optional safe
  http(s) link.
- Deliver published announcements through the site's **What's new** tab.
- Show an unread count and a lightweight in-page preview when a new update
  arrives; the widget polls gently and backs off when rate limited.
- Let visitors mark an announcement as read, react with a like, and leave a
  comment.
- Keep **reads, reactions, and comments attached to each announcement**, so
  release feedback is not mixed into a general survey stream.
- See per-announcement read, reaction, and comment counts from the
  authenticated dashboard's announcement cards.

The announcements section is enabled per site and shares the same configurable
launcher as Feedback. Admins can set the position, light/dark theme, accent,
radius, width, label, and custom launcher icon from **Widget**. If a site only
uses one section, the launcher opens directly into that section; when both are
enabled, visitors get a two-tab **What's new / Feedback** panel.

This gives TraceUX a simple product-feedback loop:

```
visitor journey → session replay → contextual feedback → shipped announcement
                                      ↑                         ↓
                                      └──── per-update reaction/comment ────┘
```

## Session behavior

- **2-hour cap** — a single session never records more than 2 hours of active time. The tracker splits a marathon visit into a fresh session at the cap (shipping the final events and duration of the outgoing session), and the server independently caps the stored duration, so buggy or hostile clients can't inflate it. Time with the tab hidden doesn't count; 30 minutes of inactivity or a hidden tab also ends a session.
- **Country without browser geolocation** — when TraceUX runs behind a trusted reverse proxy, it stores only the normalized country code from common proxy geo headers (`CF-IPCountry`, CloudFront, or `X-Country-Code` variants). Sessions without that header show the country as unknown.
- **Filter by any visited path** — the URL filter on the sessions list matches the entry URL, the exit URL, *and every page the visitor navigated through*, so searching `pricing` finds sessions that merely passed by the pricing page.

## Privacy model

- All form inputs are **masked by default** in recordings.
- Add `class="trace-ux-block"` to remove an element from recording entirely; `trace-ux-mask` masks its text.
- Visitors with Do Not Track enabled, or `localStorage.trace_ux_optout = '1'`, are never recorded.
- Raw IPs are never stored — only a salted, truncated hash for dedupe.
- Everything lives on your server. Nothing leaves it.

## Architecture

```
┌──────────────┐   batches (gzip, sendBeacon/fetch)   ┌─────────────────────┐
│  tracker.js  │ ───────────────────────────────────▶ │  Go server :8080    │
│ (~24 KB, on  │   hello / events / page / ping       │  ingest → gzip blob │
│  your site)  │                                      │  → SQLite (WAL)     │
└──────────────┘                                      │  + embedded SPA     │
                                                      └──────────┬──────────┘
                                    rrweb-player reconstructs   │
                                    the page as a "fake video"  ▼
                                                 dashboard ◀── SQLite
```

- **`tracker/`** — TypeScript SDK wrapping [`@rrweb/record`](https://rrweb.io/). Records DOM mutations as compact event streams; batches and ships them compressed (2 KB threshold, `CompressionStream`), surviving page navigations via `sessionStorage` (session id, page index, active time all persist).
- **`server/`** — Go + `modernc.org/sqlite` (pure Go, no CGO). Events are stored as gzipped blobs per chunk (not one row per event), keeping SQLite fast and the file small. Retention job sweeps expired sessions every 6 h.
- **`dashboard/`** — Vite + React + `rrweb-player`. Chunks stream back
  decompressed in pages as you watch; site hubs also configure feedback,
  announcements, widget styles, logs, and performance keys.
- **`demo/`** — a pretend customer site with the snippet installed, for
  testing replay, feedback, multi-page navigation, and the unified
  announcements widget.

Capacity design point: 30 concurrent sessions ≈ 6–10 tiny requests/sec (a few % of one core). The same design comfortably reaches thousands of concurrent sessions on a 2–4 GB VPS before needing a queue/ClickHouse — at which point that's the next milestone, for any language.

## Development

```bash
./traceux --start # Go API on :8090 + Vite dashboard on :5173 with HMR
make dev          # same development launcher
make serve-demo   # demo site on :8081 (edit demo/*.html, set your site key)
make test         # Go tests (ingest flow, auth, UA parsing, multi-page sessions)
make build        # production binary: server/trace-ux
```

Frontend changes update in the browser as you save through Vite HMR. The launcher
builds the tracker once at startup; after tracker changes, run `cd tracker && npm
run build` and reload the tracked page. Production remains a single binary with
the dashboard and tracker embedded via `make build`. Startup prints the configured
`TRACE_UX_PASSWORD`; an existing database may still have a different password if
the admin changed it.

## Building the release artifact

```bash
docker build -f deploy/Dockerfile -t trace-ux .
```

Multi-stage: frontend bundles built with esbuild/Vite, then a `CGO_ENABLED=0` Go build embeds them (`go:embed`) into one distroless image.

## FAQ

**Is this a real video?** No — and that's the point. We store DOM/style event streams and reconstruct the page in the player. It's tiny (~KBs per screen vs MBs per video second), searchable, and never captures actual pixels.

**What about SPAs?** Route changes via the History API are detected and become page entries in the session timeline.

**How can I add a demo “watch my visit” button?** The optional demo capability is disabled by default. Enable it only on an isolated demo deployment, then call `window.TraceUX.claimReplay()` from a button handler and redirect to the returned relative URL. The server stores only a keyed hash of the random capability, scopes it to the current site/session, rate-limits claims, and expires it automatically. This is intended for a private demo overlay, not as a replacement for dashboard authentication.

```html
<button id="watch-my-visit" type="button">Watch my visit</button>
<script>
  document.querySelector('#watch-my-visit').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const link = await window.TraceUX.claimReplay();
      // The server currently returns a same-origin relative path.
      window.location.assign(new URL(link.url, window.location.origin).href);
    } catch {
      button.disabled = false;
      button.textContent = 'Replay unavailable';
    }
  });
</script>
```

**Can I see who the user was?** By design, no. Sessions are anonymous; no cookies, no cross-site identity, no raw IPs.

## License

TraceUX is available under the [TraceUX Community Source License v1.0](LICENSE).
You may use, clone, modify, collaborate on, and host it without a license fee.
Shared or hosted versions must retain TraceUX branding and notices, and
modified versions must provide their corresponding source. White-labeling,
rebranding, or selling or distributing TraceUX as a separate product under
another brand is not permitted.

This is a source-available license, not an OSI-approved open-source license.
