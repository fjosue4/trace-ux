# Webshots

Self-hosted, open-source session replay for your websites — a lean, privacy-first Hotjar alternative.

Webshots records how real visitors use your site (DOM event streams, not video), stores them on **your own server**, and plays them back in a clean dashboard. One binary, one SQLite file, one Docker container.

> **Status: v0.1 — session replay core.** Working: multi-page session capture, full replay player, input masking, UTM/referrer attribution, per-site keys, retention. Roadmap: heatmaps (click data is already captured), funnels, feedback widget, multi-user auth.

## Why

Existing self-hosted options are heavy: full analytics suites that need 8 GB+ RAM, multi-service Docker stacks, or paid plugins. Webshots is built for **a tiny VPS**: a single static binary (~20 MB, ~30 MB RAM) with SQLite and the dashboard embedded. Backups are copying one folder.

## Quickstart

**Docker** (recommended):

```bash
mkdir webshots && cd webshots
docker run -d --name webshots -p 8080:8080 -v "$PWD/data:/data" \
  -e WS_PASSWORD=change-me ghcr.io/webshots/webshots:latest
```

Or with docker-compose (optional Caddy TLS included):

```bash
cd deploy && WS_PASSWORD=change-me docker compose up -d
```

**Single binary** (any Linux/macOS, amd64/arm64):

```bash
WS_PASSWORD=change-me ./webshots
```

Then:

1. Open `http://your-server:8080`, log in with `WS_PASSWORD`.
2. **Add site** → copy the snippet:

   ```html
   <script async src="http://your-server:8080/t.js" data-site="YOUR_SITE_KEY"></script>
   ```

3. Paste it into the `<head>` of every page on your site. Sessions start appearing within seconds.

## Configuration

| Env var            | Default   | Meaning                                    |
| ------------------ | --------- | ------------------------------------------ |
| `WS_PASSWORD`      | `webshots`| Dashboard password (**set this**)          |
| `WS_DATA`          | `./data`  | Data dir (SQLite db + auth secret)         |
| `WS_ADDR`          | `:8080`   | Listen address                             |
| `WS_RETENTION_DAYS`| `90`      | Auto-delete sessions older than this       |
| `WS_DEV_STATIC`    | —         | Dev only: serve frontend builds from disk  |

## Privacy model

- All form inputs are **masked by default** in recordings.
- Add `class="ws-block"` to remove an element from recording entirely; `ws-mask` masks its text.
- Visitors with Do Not Track enabled, or `localStorage.ws_optout = '1'`, are never recorded.
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
- **`dashboard/`** — Vite + React + `rrweb-player`. Chunks stream back decompressed in pages as you watch.
- **`demo/`** — a pretend customer site with the snippet installed, for testing.

Capacity design point: 30 concurrent sessions ≈ 6–10 tiny requests/sec (a few % of one core). The same design comfortably reaches thousands of concurrent sessions on a 2–4 GB VPS before needing a queue/ClickHouse — at which point that's the next milestone, for any language.

## Development

```bash
make dev          # Go server on :8090 serving live frontend builds
make serve-demo   # demo site on :8081 (edit demo/*.html, set your site key)
make test         # Go tests (ingest flow, auth, UA parsing, multi-page sessions)
make build        # production binary: server/webshots
```

Frontend work: `cd dashboard && npm run dev` (Vite on :5173, proxied to :8090). Tracker work: `cd tracker && npm run build`, then reload any page with the snippet.

## Building the release artifact

```bash
docker build -f deploy/Dockerfile -t webshots .
```

Multi-stage: frontend bundles built with esbuild/Vite, then a `CGO_ENABLED=0` Go build embeds them (`go:embed`) into one distroless image.

## FAQ

**Is this a real video?** No — and that's the point. We store DOM/style event streams and reconstruct the page in the player. It's tiny (~KBs per screen vs MBs per video second), searchable, and never captures actual pixels.

**What about SPAs?** Route changes via the History API are detected and become page entries in the session timeline.

**Can I see who the user was?** By design, no. Sessions are anonymous; no cookies, no cross-site identity, no raw IPs.

## License

[AGPL-3.0](LICENSE) — same as Plausible and Matomo. Use it, host it, modify it; if you offer it as a service, share your changes.
