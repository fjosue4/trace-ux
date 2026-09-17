# Migrating TraceUX: openclaw-vps → replyprotux

**Status:** phase 1 done. **Pre-seed staged 2026-09-17 01:35 UTC** — see below.
Remaining steps on your word.
**Cutover method:** Cloudflare only. **openclaw's nginx is never edited or reloaded.**
**Budget:** 5 minutes downtime. Measured expectation: **~30-60 seconds**, most of
it you pressing Save.

| | openclaw-vps | replyprotux |
|---|---|---|
| IP | 204.168.161.1 | 158.220.125.7 |
| spec | 2 core / 3.7 GiB / 28 GB free | 6 core / 17 GiB / **966 GB free** |
| build | `v0.3.2` | `v0.3.2` — identical |
| schema | `62b5cc07…`, 57 objects, auto_vacuum=2 | `62b5cc07…`, 57 objects, auto_vacuum=2 — identical |
| data | **523 MB**, 161 sessions, 12,693 chunks, 37 stylesheets | empty |
| also hosts | **ai-service**, user-status, surveys, contact-service | nothing else |

Verified 2026-09-16: both boxes answer `/api/health`, and openclaw can reach
replyprotux over SSH directly as root.

---

## Why openclaw's nginx is out of scope

The earlier draft of this plan ended the outage by repointing openclaw's
trace-ux vhost at the new box and reloading nginx, so DNS could move later at
leisure. That reload is graceful and touches one vhost file — but it is the
**same nginx that fronts ai-service**, which must not be touched. The ~30
seconds it would have saved is not worth putting a hand on that surface.

So DNS is the switch, and **the outage lasts until you flip the record.** That
is the trade: no shared-nginx risk, but you have to be at the keyboard.

## Why downtime exists at all

A consistent copy requires writes to stop. SQLite's WAL means a live copy can
land mid-transaction, so the database must be quiet for the final sync.

The window is short because of **pre-seeding**: the bulk of the 523 MB copies
while openclaw is still serving, and only the delta accumulated during that
copy moves inside the outage.

## What the outage costs

The tracker retries a failed batch 4 times with backoff — roughly **15 seconds**
of cover. A ~90-second outage exceeds it, so **sessions recording during the
swap will lose batches and their replays will have gaps.** Nothing already
stored is lost, and sessions that start after the cutover are unaffected.

At 19:25 local there were 6 sessions active in the last 15 minutes. Run this
when that number is 0.

---

# Phase 2 — Migrate (on your word)

### Step 0. Pre-seed — openclaw stays live, **no downtime** ✅ DONE

```
rsync -a --delete /var/lib/trace-ux/ 158.220.125.7:/var/lib/trace-ux.incoming/
```

**Ran 2026-09-17 01:35 UTC: 552,640,600 bytes in 14.5s at 38 MB/s.** openclaw
served throughout. The staged copy is *inconsistent* — it was taken from a live
WAL and must not be started as-is. It exists only so step 2 has nothing to move.

`/var/lib/trace-ux` on replyprotux is **untouched** (300 KB, still its own empty
database). Nothing is swapped until step 3.

### Step 1. Stop writes — **downtime starts**

```
systemctl stop trace-ux          # on openclaw
```

From here the subdomain returns 502 until step 4.

### Step 2. Final sync — consistent now

Same rsync. **Measured at 1.2s** against the staged copy while openclaw was
live: in WAL mode the 548 MB main database is byte-identical between
checkpoints, so rsync skips it and moves only the small `-wal`.

The clean shutdown in step 1 checkpoints and truncates that WAL, which rewrites
pages scattered through the main file — so the real final sync will be slower
than 1.2s, bounded by a full re-send at **~15s**. Add `-W` to skip the delta
algorithm and just push the bytes; at 38 MB/s that is the faster path here.

### Step 3. Swap it in on replyprotux

```
systemctl stop trace-ux
rm -rf /var/lib/trace-ux.old && mv /var/lib/trace-ux /var/lib/trace-ux.old
mv /var/lib/trace-ux.incoming /var/lib/trace-ux
chown -R trace-ux:trace-ux /var/lib/trace-ux
systemctl start trace-ux
```

Keeping `.old` means rollback is a rename, not a restore.

### Step 4. Verify before calling you — I do this, it takes seconds

- `systemctl is-active trace-ux`
- `/api/health` → `{"status":"ok"}`
- schema hash matches `62b5cc07…`, auto_vacuum=2
- session and chunk counts match openclaw **exactly**
- one real replay loads, via `curl --resolve` against 158.220.125.7
  (a client-side flag — it resolves nothing publicly and touches no DNS)

### Step 5. **You flip the record — downtime ends**

In Cloudflare, edit the `trace-ux` A record:

```
204.168.161.1  ->  158.220.125.7        proxied (orange), TTL auto
```

Proxied records take effect at the edge in seconds. I will confirm the new
origin is serving before you do this, and confirm traffic has landed after.

openclaw's trace-ux service **stays stopped** afterwards, so nothing can write
to the old database and diverge from the new one.

---

## Rollback

| when | action | cost |
|---|---|---|
| before step 3 | `systemctl start trace-ux` on openclaw | seconds, nothing lost |
| after step 3, before step 5 | same — DNS never moved, openclaw is still the origin | seconds, nothing lost |
| after step 5 | point the A record back, start openclaw's service | edge propagation, seconds; anything recorded on the new box since the swap stays there |

openclaw keeps its data throughout — nothing is deleted until you say so.

## Afterwards

- Remove the openclaw → replyprotux SSH key; it exists only for this copy
- Delete `/var/lib/trace-ux.old` on replyprotux once you are satisfied
- **Run certbot on replyprotux** so renewals continue from the new origin. The
  copied cert is valid to **15 Dec 2026**, so this is not urgent — but it must
  happen before then, and only works once DNS points here
- **The login becomes openclaw's.** Users live in the database, so the admin
  password that comes across is the one you use on openclaw today.
  `TRACE_UX_PASSWORD` in replyprotux's env only bootstraps an empty database
  and will be inert after the swap
- Retention is already 30 days on replyprotux (openclaw runs 15, sized for its
  small disk). Nothing migrated is older than 30 days, so the change prunes
  nothing on arrival — it just stops the 15-day sweep discarding history you
  now have room to keep
- The **site key is unchanged**, so every tracker snippet already deployed
  keeps working with no edit
- openclaw still runs user-status, surveys, contact-service and **ai-service** —
  it is not decommissioned by this migration
