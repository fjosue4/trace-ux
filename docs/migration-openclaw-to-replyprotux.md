# Migrating TraceUX: openclaw-vps → replyprotux

**Status:** phase 1 done. Phase 2 on your word, phase 3 on mine.
**Budget:** 5 minutes downtime. Expected: **~60 seconds.**

| | openclaw-vps | replyprotux |
|---|---|---|
| IP | 204.168.161.1 | 158.220.125.7 |
| spec | 2 core / 3.7 GiB / 29 GB free | 6 core / 17 GiB / **966 GB free** |
| build | `0.2.10-main` | `0.2.10-main` (identical) |
| schema | v16, auto_vacuum=2 | v16, auto_vacuum=2 |
| data | **459 MB**, 107 sessions, 9,353 chunks, 29 stylesheets | empty |
| also hosts | ai-service, user-status, surveys, contact-service | nothing else |

---

## Why downtime exists at all

A consistent copy requires writes to stop. SQLite's WAL means a live copy can
land mid-transaction, so the database must be quiet for the final sync. That
floor is unavoidable without dual-write, which costs far more complexity than a
minute of downtime is worth here.

The floor is small because of **pre-seeding**: the bulk of the 459 MB copies
while openclaw is still serving, and only the delta accumulated during that copy
moves inside the window.

## The retry window does NOT cover this

The tracker retries a failed batch 4 times with backoff — roughly **15 seconds**
of cover. A 60-second outage exceeds it, so sessions active during the swap will
lose batches and their replays will have gaps.

Two consequences:

- **Run it at low traffic.** Outside working hours costs nothing.
- **Step 6 removes the rest of the exposure** by restoring service through
  openclaw's nginx before DNS moves, so the gap is the sync window only, not the
  window plus however long DNS takes.

## Prepared already (phase 1)

- replyprotux installed, same build, same config, budget raised 25 GB → 300 GB
- **Certificate already copied across** — both boxes hold a valid cert for
  `trace-ux.replypro.io`, so cutover has no TLS gap and needs no issuance
- nginx vhost live and verified under the real hostname with DNS bypassed
- ufw: 22/80/443. Limits: `CPUQuota=500%`, `MemoryMax=12G`
- **Direct openclaw → replyprotux SSH key installed**, so the 459 MB goes
  datacentre-to-datacentre rather than round-tripping through your laptop

---

# Phase 2 — Migrate (on your word)

### 1. Pre-seed, openclaw still live — no downtime

```
rsync -a --delete /var/lib/trace-ux/ 158.220.125.7:/var/lib/trace-ux.incoming/
```

Copies ~459 MB with the service running. The result is *inconsistent* and is not
used as-is; it exists so step 3 has almost nothing left to move.

### 2. Stop writes — **downtime starts**

```
systemctl stop trace-ux          # on openclaw
```

### 3. Final sync — consistent now

Same rsync. Only the delta moves, plus a WAL checkpoint the stop already forced.
Seconds.

### 4. Swap it in on replyprotux

```
systemctl stop trace-ux
rm -rf /var/lib/trace-ux.old && mv /var/lib/trace-ux /var/lib/trace-ux.old
mv /var/lib/trace-ux.incoming /var/lib/trace-ux
chown -R trace-ux:trace-ux /var/lib/trace-ux
systemctl start trace-ux
```

Keeping `.old` means rollback is a rename, not a restore.

### 5. Verify before declaring success

- `systemctl is-active trace-ux`
- `/api/health` → `{"status":"ok"}`
- schema is v16 and `auto_vacuum=2`
- session and chunk counts match openclaw exactly
- one real replay loads, via `curl --resolve` against 158.220.125.7

### 6. Restore service through openclaw — **downtime ends**

Point openclaw's vhost at the new box instead of its own loopback:

```
proxy_pass https://158.220.125.7;   # was http://127.0.0.1:8080
```

`nginx -t`, then reload. Traffic arriving on the current DNS now reaches
replyprotux. **This is what decouples DNS from the outage** — without it,
downtime lasts until the record propagates.

---

# Phase 3 — DNS (when I tell you, after phase 2 verifies)

In Cloudflare, edit the `trace-ux` A record:

```
204.168.161.1  ->  158.220.125.7        proxied (orange), TTL auto
```

Proxied records take effect at the edge in seconds. Because step 6 already
restored service, **this step has no downtime at all** — it just removes the
extra hop.

Then confirm traffic reaches the new origin directly, and only afterwards
decommission openclaw's vhost.

---

## Rollback

| when | action | cost |
|---|---|---|
| before step 4 | `systemctl start trace-ux` on openclaw | seconds, nothing lost |
| after step 4 | revert openclaw's `proxy_pass`, start its service | seconds; anything recorded on the new box since the swap stays there |
| after phase 3 | point the A record back | edge propagation, seconds |

openclaw keeps its data throughout — nothing is deleted until you say so.

## Afterwards

- Remove the openclaw → replyprotux SSH key; it exists only for this copy
- Delete `/var/lib/trace-ux.old` on replyprotux once you are satisfied
- Run certbot on replyprotux so renewals continue from the new origin (the
  copied cert is valid to **15 Dec 2026**, so this is not urgent — but it must
  happen before then, and only works once DNS points here)
- Retention is **already set to 30 days** on replyprotux (openclaw runs 15,
  sized for its 29 GB disk). Nothing in the migrated data is older than that, so
  the change prunes nothing on arrival — it simply stops the 15-day sweep from
  discarding history you now have room to keep
- openclaw still runs user-status, surveys, contact-service and ai-service —
  **it is not decommissioned by this migration**
