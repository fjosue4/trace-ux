# Webshots — self-hosted, open-source session replay (a lean Hotjar)

**Why build:** Existing self-hosted options fail the "extremely easy" bar — OpenReplay needs an 8 GB multi-service Docker stack, PostHog's self-host path is enterprise-scale, Matomo charges for heatmaps/replay. On **rrweb** (MIT, the DOM-recording engine most of them use) we can build a one-binary tool for small VPSes. Your "fake video" intuition is exactly rrweb's model: store DOM/style event streams, reconstruct the page in the dashboard player — no real video.

**Stack (decided):** Go backend + embedded SQLite + gzipped event blobs · React/TypeScript dashboard with rrweb-player · TypeScript tracker (~5 KB) wrapping `rrweb.record()`. License: AGPL-3.0.

**Capacity targets:** 30 concurrent sessions ≈ 6–10 req/s of small gzipped batches — a few % of one core for this design. Headroom goal: thousands of concurrent sessions on a 2–4 GB VPS before any architecture change; < 100 MB RAM idle in the common case.

## Repo layout (monorepo)
```
webshots/
├── server/          # Go: API, ingest, auth, static embedding (go:embed)
├── dashboard/       # Vite + React + TS: login, sites, sessions list, replay
├── tracker/         # TS SDK wrapping rrweb; bundled to one IIFE file
├── demo/            # Static demo site with the snippet installed (for testing)
├── deploy/          # Dockerfile, docker-compose.yml (optional Caddy TLS)
└── Makefile         # dev, build, test, release
```

## Data model (SQLite, single file in /data)
- `sites(id, name, site_key, created_at)`
- `sessions(id, site_id, started_at, last_seen, duration, page_count, initial_url, exit_url, referrer, utm_*, browser, os, device, viewport_w/h, screen_w/h, ip_hash, country, user_agent, sample_rate, event_count)`
- `chunks(session_id, seq, data BLOB gzip, created_at)` — rrweb event batches as gzipped blobs (~KBs each), NOT one row per event
- `pages(session_id, url, entered_at, left_at)` — page timeline for the replay sidebar
- Retention: daily cleanup deletes sessions older than N days (config, default 90).

## API contract
- `GET /t.js` — tracker script for the snippet (cacheable, ~5 KB)
- `GET /api/config/{site_key}` — sampling rate, masking settings, checkout interval
- `POST /api/ingest/{site_key}` — batches: `{type: "hello"|"events"|"page"|"ping", ...}`; supports `sendBeacon` (text/plain) and fetch-keepalive; CORS `*`; gzip bodies accepted; per-session `seq` for ordering
- Dashboard APIs (session-cookie auth): `POST /api/auth/login` (password from env; single user in v1), `GET/POST /api/sites`, `GET /api/sessions?filters...`, `GET /api/sessions/{id}`, `GET /api/sessions/{id}/chunks/{seq}` (streamed gzip blobs)

## Tracker behavior
rrweb.record (checkout every 30s; all `<input>` text masked by default; `.ws-ignore` / `data-ws-mask` opt-outs; honor Do Not Track + `localStorage.ws_optout`) + History-API patching for SPAs + click events + viewport/UA/UTM capture on `hello`. Flush every 5 s / 20 events / on `pagehide` via sendBeacon; pause when tab hidden > 30 min. Click coordinates are captured from day one so heatmaps can be added in v2 without schema churn.

## Replay experience (the Hotjar feel)
Sessions list (date/device/URL/duration filters) → replay page: rrweb-player + sidebar with pages visited, referrer, device, duration; scrubber with pageview markers; chunks lazy-loaded in order.

## Milestones
1. **Skeleton** — monorepo, Go server embedding dashboard+tracker, SQLite migrations, add-site flow, snippet serving. *Verify: install snippet, site appears.*
2. **Tracker** — rrweb wrapper, batching, privacy masking, SPA support, config endpoint.
3. **Ingest** — batch endpoint, gzip blob storage, session rows, heartbeat/timeout handling, retention job. *Verify: events land end-to-end in SQLite.*
4. **Replay** — sessions list + rrweb-player, chunk streaming, timeline. *Verify: watch your own demo-site session as a "video".*
5. **Ship** — auth, Dockerfile (~20 MB image) + compose, demo polish, README quickstart, e2e smoke test, release CI (goreleaser + GHCR image).

## First-run experience
`docker run -p 8080:8080 -v ./data:/data webshots` (or `./webshots` single binary) → login → "Add site" → copy one `<script>` line → sessions start appearing.

**Execution order:** milestones 1–5 sequentially, each verified against the `demo/` site before moving on.
