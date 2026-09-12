# TraceUX

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
| `trace-ux --password <new>` | set a new admin password (revokes old admin logins) |
| `trace-ux --update` | upgrade to the latest release |
| `trace-ux --uninstall` | remove it (recordings are kept) |
| `trace-ux --run` | run in the foreground for debugging |

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
| `TRACE_UX_DEMO_REPLAY`  | `0`       | Enable short-lived public demo replay links            |
| `TRACE_UX_DEMO_REPLAY_TTL` | `900`  | Demo replay lifetime in seconds (60–3600)             |
| `TRACE_UX_DEV_STATIC`    | —         | Dev only: serve frontend builds from disk             |

Each site opens to a tabbed hub: **Overview** keeps the latest recordings,
logs, feedback, and summary counts together; **Site** manages the registered
URL, installation snippet, and backend performance connection; **Recordings**,
**Feedback**, **Announcements**, **Styles**, and **Logs** keep each part of the
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

Mark any element to appear as seekable activity in the replay sidebar:

```html
<button trace-ux-track-id="checkout-click">Buy now</button>
```

or programmatically: `window.TraceUX.track('checkout-click')`. Clicking an activity row jumps the recording to that exact moment.

Masking: all form inputs are masked by default; any element carrying `trace-ux-mask` — as a class or as a bare attribute — has its text masked, and `trace-ux-block` (class) removes the element from the recording entirely.

### Logs

Logs can be enabled per site from the site's **Logs** configuration. Choose the minimum severity to store: errors only, warnings and errors, info and above, or all levels. Captured rows are linked to the visitor's recording session and appear in the dashboard's **Logs** page, which opens in a live view of the last 15 minutes, refreshes every 5 seconds, and shows up to 1,000 rows. The page also supports site, severity, preset time-window, and custom time filters.

Log storage has two independent per-site caps: 15 days by default and 1,000,000 rows by default. The oldest rows are removed during the regular retention sweep; either cap can be changed or disabled from the same Logs configuration. Logs are also removed automatically when their related recording is removed, and are not yet shown inside the replay timeline.

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
radius, width, label, and custom launcher icon from **Styles**. If a site only
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
