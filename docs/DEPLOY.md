# Deploying InvoiceFlow

Two supported paths, in order of effort:

1. **Free cloud demo (Render + MongoDB Atlas)** — a public URL, nothing to install. Start here.
2. **Self-hosted production (Docker + Caddy)** — full control, your own domain. Uses
   `docker-compose.prod.example.yml` + `Caddyfile.example` (copy both, remove `.example`, fill in).

---

## Path 1 — Free cloud demo

One web service serves the built React client **and** the Express API from the same origin
(sessions, cookies and uploads share one HTTPS URL), backed by a free MongoDB Atlas cluster.
Background queues run in-process (`QUEUES_INLINE=1`), so no Redis service is needed.

`render.yaml` in the repo root is a Render Blueprint — most settings fill themselves in.

### Steps

1. **MongoDB Atlas** (free M0 cluster):
   - Create an account at mongodb.com → New Project → Build a Cluster → **M0 Free**.
   - Database Access → create a user (username + password).
   - Network Access → add `0.0.0.0/0` (Render's IPs are not fixed on the free tier).
   - Connect → Driver (Node.js) → copy the connection string (keep it secret).
2. **Render**: sign in with GitHub → New + → **Blueprint** → pick this repo.
   Render reads `render.yaml`; fill in the two prompts:
   - `MONGO_URI` — the Atlas connection string (replace `<password>` with the real one).
   - `BOOTSTRAP_*` — org name + the first Admin's email, name and password.
3. Deploy takes ~10 minutes. Render shows the URL when the service is live —
   opening it lands on the login page; sign in with the bootstrap Admin.

### What the free demo deliberately simplifies

| Free-tier choice | Consequence | Production answer |
|---|---|---|
| `QUEUES_INLINE=1` (no Redis service) | Background jobs run in-process; a restart can lose a queued job | Managed Redis (e.g. Upstash): set `REDIS_URL` with its TLS DSN — code support is built in |
| Uploads in `/tmp` | Uploaded documents vanish on redeploy | Attach a Render disk / S3 |
| Free plan spins down after idle | First request after idle waits ~1 min | Paid plan (always on) |
| Atlas M0 | No continuous backups | Upgrade M10+ for automated backups |

---

## Before real production — checklist

- [ ] **Managed MongoDB replica set** — Atlas M10+ (or self-hosted replica set; transactions need it).
- [ ] **Managed Redis** — set `REDIS_URL` (`rediss://…`); queues then run through BullMQ properly.
- [ ] **HTTPS everywhere** — Render provides it; self-hosted uses the included `Caddyfile.example`.
- [ ] **Back up the database** — enable Atlas continuous backups or a `mongodump` cron.
- [ ] **Back up `ENCRYPTION_KEY`** — bank details are AES-256-GCM encrypted with it.
      Losing it makes stored bank details unreadable; store it in a password manager / vault,
      never only in the service's env vars.
- [ ] **Rotate `JWT_SECRET`** only with a plan to re-issue sessions (it invalidates existing ones).
- [ ] **Accountant sign-off** — confirm TDS sections/rates, GST treatment and rounding policy
      in organisation settings before go-live.
- [ ] **Security review** — check `docs/SECURITY.md` items: secrets handling, rate limits,
      audit log retention, user offboarding.
- [ ] **Pilot** — run real bank statements and a handful of real invoices through the full
      flow (intake → match → approve → pay → reconcile) before cutting over.

## Useful commands (self-hosted path)

```bash
cp docker-compose.prod.example.yml docker-compose.prod.yml
cp Caddyfile.example Caddyfile   # edit: your domain, ACME email
docker compose -f docker-compose.prod.yml up -d
# backup:
docker compose -f docker-compose.prod.yml exec mongo mongodump --archive --gzip > backup.gz
```
