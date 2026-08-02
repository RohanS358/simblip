# SIMBLIP — Deployment & Cost Plan

**Phase 1: 1,000 users / 9 months, on Vercel. Path to 50,000.**
Written August 2026, against the codebase as it stands today (Next.js 16, self-hosted Postgres gateway, local Ollama AI agent).

---

## TL;DR

- Your current setup has one structural problem that is almost certainly *why* you're at 40GB already: **presentation/notebook files (PDFs, PPTs) are stored as `bytea` blobs inside Postgres**, not in object storage. Fix that first — it's the single biggest cost and reliability lever you have.
- The Postgres connection pool is capped at **2 connections per process** (`lib/server/pg.ts:14`). Under serverless this is a landmine, not a phase-1 problem — fix it now while it's cheap to fix.
- The AI feature (`/api/ai`) talks to a **local Ollama server** (`lib/ai/ollama.ts`). It cannot run on Vercel as-is. Decide explicitly whether it ships in phase 1 — this is a real infrastructure decision, not a toggle.
- With those three things fixed, **1,000 users for 9 months realistically costs $360–$800 total** (≈$40–$90/month), all on usage-based managed services, no ops burden.
- 50,000 users is a different architecture in a few specific places (polling, file egress, connection pooling, DB compute) — not a full rewrite. Section 8 covers what changes and when.

---

## 1. What you're actually running today

Grounded in the code, not assumptions:

| Layer | What it is | File |
|---|---|---|
| Frontend/API | Next.js 16 App Router, React 19, deployed on Vercel | `next.config.js` |
| Database | Plain Postgres via `pg` (node-postgres), reached over `DATABASE_URL` — **not** Supabase, not Vercel Postgres. Custom gateway at `/api/pg` re-implements a PostgREST-like query dialect | `lib/server/pg.ts`, `app/api/pg/[table]/route.ts` |
| Auth | Self-rolled: scrypt password hashes + HS256 JWT, no external auth provider | `lib/server/auth.ts` |
| File storage | PDFs/PPTs/presentation attachments stored as `bytea` **inside Postgres** (`simblip_session_files`), served through `/api/files` | `db/schema.sql:254-259`, `app/api/files/[...path]/route.ts` |
| Sync | Offline-first: notebook edits debounce-push every 2s; dashboard-style views (announcements, assignments, library, rooms, boards) **poll every 4s** while mounted; a live classroom board polls its remote-control channel at ~1Hz | `lib/sync/cloud.ts`, `lib/data/db.ts:185`, `app/board/page.tsx:452-459` |
| AI | Local Ollama tool-calling agent (`qwen2.5:7b` by default), reached over `OLLAMA_HOST` — this is a fetch to a server *you* have to run somewhere | `lib/ai/ollama.ts` |
| Multi-tenancy | Institutions → rooms → profiles, tenant isolation enforced in the `/api/pg` gateway, not DB-level RLS | `db/schema.sql`, `app/api/pg/[table]/route.ts:83-108` |

This is a genuinely lean, dependency-light architecture — no Supabase bill, no auth-provider bill, no ORM tax. The cost problem isn't the architecture's complexity, it's two specific decisions (blobs-in-Postgres, unpooled connections) that are cheap to fix now and expensive to fix at 50,000 users.

---

## 2. Fix before you scale past a handful of pilot users

These aren't "phase 2 optimizations" — they're correctness/cost issues that get harder to fix the more data and users you have. Do these first.

### 2.1 Move files out of Postgres (highest priority)

`simblip_session_files` stores raw PDF/PPT bytes as `bytea` (`db/schema.sql:254`). Every one of those files:
- inflates your Postgres storage bill directly (storage is billed per-GB on every managed Postgres provider),
- inflates backup size and backup *time*,
- sits in Postgres's shared buffer cache, evicting the actually-hot relational/jsonb rows and slowing down every other query,
- gets held via a **2-connection pool** while large blobs stream in and out (§2.2).

This is very likely most of your current 40GB. A few hundred PDFs/PPTs at a few MB each adds up fast when they're stored as database rows instead of object storage.

**Fix:** move to **Vercel Blob** (simplest — same platform, no new account, generous free tier) or **Cloudflare R2** (cheapest at volume — zero egress fees, matters once file *reads* dominate). For phase 1, Vercel Blob is the pragmatic choice; re-evaluate R2 when you have real transfer numbers (§8.3).

Code impact is contained: `app/api/files/[...path]/route.ts` (3 handlers) and `lib/data/session-upload.ts` are the only places that touch this table — swap the `q()` calls for `put()`/`del()` against Blob, keep the same URL contract (`/api/files/<path>` → redirect or proxy to the Blob URL).

Files are already ephemeral by design (3h sweep for presentation attachments, 7-day rolling TTL for notebook documents) — that logic doesn't change, it just targets a store built for this instead of a relational database.

### 2.2 Fix the connection pool

```ts
// lib/server/pg.ts:12-17
pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  ...
})
```

`max: 2` was presumably chosen defensively for serverless (avoid opening hundreds of connections across cold-started instances). With **Fluid Compute** (Vercel's current default), function instances are reused across concurrent requests rather than spun up one-per-request, so this is more conservative than it needs to be — and it's still fragile: if your DB's real connection ceiling is, say, 100, only ~50 concurrent warm instances can each hold their 2 connections before new requests start queuing or erroring on `/api/pg` and `/api/files`.

**Fix, in order of importance:**
1. Point `DATABASE_URL` at your provider's **pooled connection string** (Neon and Supabase both expose a PgBouncer-fronted pooler endpoint, transaction-mode) — this is the real fix, it decouples "how many Postgres backends exist" from "how many function instances are warm."
2. Once pooled, `max: 2` can stay conservative-but-safe, or move to something like 5–10 per instance now that instances live longer under Fluid Compute.

This is a one-line env var change plus confirming your provider's pooler is enabled — do it now, it costs nothing and removes your single biggest "mystery 500 errors under load" risk.

### 2.3 Decide what happens to the AI feature

`lib/ai/ollama.ts` fetches `OLLAMA_HOST` (default `http://localhost:11434`). On Vercel, `localhost` is the function's own ephemeral container — there is no Ollama there. Every `/api/ai` call in production will hit `OllamaUnreachableError` unless you point `OLLAMA_HOST` at a real, always-on server you operate.

This isn't a bug to fix — it's an infrastructure decision with a real cost, and it should be made deliberately rather than discovered by a user hitting "Generate" during launch week. Three real options, cheapest first:

| Option | Cost | Trade-off |
|---|---|---|
| **A. Ship without it** — feature-flag `/api/ai` off (or hide the entry point) for phase 1 | $0 | No AI in the pilot. Cleanest for a "no errors" first 9 months — nothing to keep alive, nothing to monitor. |
| **B. One small always-on box** running `ollama serve` + your `simblip-simscript` model, e.g. a Hetzner CPX41 (8 vCPU/16GB RAM) | ~€20–30/mo (~$22–33) | CPU inference on a 7B Q4 model is workable but slow (think 10–60s per generation, `REQUEST_TIMEOUT_MS` in the code is already set to 180s to accommodate this). Fine as an opt-in "beta" feature for a subset of pilot users. |
| **C. GPU serverless** (e.g. RunPod) reached over the same `OLLAMA_HOST`-style HTTP call | Pay-per-second, roughly $0.2–1+/hr of active generation depending on GPU tier | Faster, scales with demand, no idle cost — but adds a second platform to operate, and cold-start model loading needs handling. Overkill for 1,000 pilot users. |

**Recommendation for phase 1:** Option A at launch, Option B once you have real users asking for it. It's a single env var (`OLLAMA_HOST`) to turn on later — don't pay for or operate a GPU/CPU box before you know anyone wants the feature.

---

## 3. Recommended phase-1 stack (1,000 users, 9 months)

| Component | Choice | Why |
|---|---|---|
| Hosting | **Vercel Pro** | Hobby plan explicitly forbids commercial use and caps bandwidth at 100GB/mo — not viable for a real multi-tenant launch even at 1,000 users. |
| Database | **Neon Postgres** (Launch, pay-as-you-go), pooled connection, autoscale-to-zero off-hours | Matches the "plain Postgres, no vendor SDK" architecture already in the code (`db/schema.sql` explicitly says "No Supabase, no RLS"). Scale-to-zero means you're not paying for idle compute overnight/weekends. |
| File storage | **Vercel Blob** | Native to the platform you're already on; ephemeral files (3h/7d TTL) keep steady-state storage small. |
| Error tracking | Sentry free tier (or Vercel's own Observability) | You have Vercel Analytics already (`@vercel/analytics` in `package.json`) but nothing that tells you when `/api/pg` or `/api/auth` starts throwing. This is the cheapest insurance against silent failures. |
| Uptime monitoring | UptimeRobot / Better Uptime free tier, pinging a `/api/health` route every few minutes | Free, catches "the DB pooler fell over at 2am" before a user does. |
| AI (optional) | Off at launch; Hetzner CPX41 if/when enabled | See §2.3. |
| Domain | Already owned (`simblip.rohan-singh.com.np`) | No incremental cost. |

### 3.1 Monthly budget

Assumptions (state these so the numbers are checkable, not vibes): 1,000 registered users, realistic peak concurrency 5–15% (50–150 concurrent during class hours, near-zero overnight), notebook sync is push-debounced (cheap), dashboard views poll every 4s only while a tab is open on that view, AI feature off, files migrated per §2.1.

| Line item | Low | High | Notes |
|---|---:|---:|---|
| Vercel Pro (base) | $20 | $20 | Includes $20 of usage credit + 1TB Fast Data Transfer/mo — likely covers this scale outright |
| Vercel Functions overage | $0 | $15 | Active CPU $0.128/hr, invocations $0.60/1M — headroom under the Pro credit at this traffic |
| Neon Postgres (storage + autoscale compute) | $15 | $35 | Storage $0.35/GB-mo, compute $0.106/CU-hr; small dataset once blobs are out |
| Vercel Blob (storage + transfer) | $5 | $15 | Storage $0.023/GB-mo, transfer $0.05/GB; ephemeral files keep footprint low |
| Monitoring (Sentry + uptime) | $0 | $0 | Free tiers cover this scale comfortably |
| **Total (AI off)** | **$40** | **$85** | **≈ $360–$765 over 9 months** |
| + Ollama box (if enabled) | +$22 | +$33 | Hetzner CPX41-class, always-on |
| **Total (AI on, phase 2 of the pilot)** | **$62** | **$118** | **≈ $560–$1,065 over 9 months** |

These are current public list prices (Vercel, Neon, Vercel Blob — see sources at the bottom), not a quote — usage-based lines depend on real traffic. Set a **spend alert on the Vercel dashboard** on day one; it's the cheapest protection against a runaway loop (a polling bug, a retry storm) turning into a surprise bill.

---

## 4. "No errors" reliability checklist

Independent of cost — these are the things that actually determine whether 1,000 people have a smooth 9 months:

- [ ] **Pooled `DATABASE_URL`** (§2.2) — the #1 source of "random 500s under load" in this codebase as it stands.
- [ ] **Rate limit `/api/auth`.** `lib/server/auth.ts` uses scrypt (deliberately CPU-heavy) with no visible rate limiting on login attempts. An unrate-limited login endpoint under scripted probing burns both Active CPU (cost) and your 2-connection pool (availability) at the same time. A simple per-IP+email counter (in-memory is fine given Fluid Compute instance reuse, or Vercel Runtime Cache for correctness across instances) closes this.
- [ ] **Health check + uptime alerting** — a `/api/health` route that checks DB reachability, wired to a free uptime monitor with email/Slack alerting.
- [ ] **Error tracking wired up before launch, not after the first complaint.**
- [ ] **Confirm your DB provider's point-in-time recovery window** and do one test restore before go-live. Multi-tenant education data (submissions, assignments, library assets) with no verified backup story is the kind of thing that's fine for months until it isn't.
- [ ] **Vercel spend limit set.**
- [ ] **Static asset cleanup** — `public/cover/` has duplicate PNG+SVG pairs of the same cover art, several running 1–3.5MB each (`cover-3.svg` at 3.5MB, `cover-3.png` at 1.9MB, etc.). Free win on bandwidth: keep one format, compress it. `next.config.js` also sets `images: { unoptimized: true }`, which means Next's automatic resize/compression pipeline is bypassed entirely — worth revisiting once you have real Core Web Vitals data from actual users.

None of this is expensive. All of it is the difference between "runs smoothly" and "works until it doesn't."

---

## 5. Suggested sequencing

Don't do all of §2 as one big-bang migration. Order that minimizes risk:

1. **Pool the connection string** — zero code change, just env vars + confirming the provider's pooler is on. Ship this first, today.
2. **Add rate limiting to `/api/auth`** — small, isolated, no data migration.
3. **Migrate `simblip_session_files` to Vercel Blob** — write-through both stores for a short window if you want a safety net, then cut over reads, then drop the old table. This is the one with an actual data migration (existing rows, if any are still live given the 3h/7-day TTLs — likely near-empty already).
4. **Health check + monitoring + spend alert** — an afternoon, do it before onboarding real users, not after.
5. **AI: leave off** until you've decided you want it (§2.3).

---

## 6. Scaling to 50,000 users — what actually changes

50x the users doesn't mean 50x the architecture. Most of this codebase (offline-first sync, debounced push, JWT auth, jsonb-per-page storage) scales fine as-is. Six things specifically don't, in the order they'll bite:

### 6.1 The 4-second polling model

`lib/data/db.ts:185` polls every subscribed dashboard table every 4 seconds while a tab has that view mounted (announcements, assignments, library, rooms, boards — not the notebook editor itself, which is push-based). At 1,000 users with, say, 10% concurrently on a dashboard view, that's ~25 req/s. At 50,000 users with the same ratio, that's **~1,250 req/s** from polling alone — before any actual editing traffic. This becomes the dominant cost and DB-load driver well before 50,000 users.

**Fix, in order of effort:** cheap first — add conditional requests (a lightweight `updated_at`/ETag check that returns 304 with no real query on no-change), or simply lengthen the interval for less time-sensitive views. Better, longer-term: Vercel Functions now support **WebSockets and SSE natively** under Fluid Compute — push changes instead of polling for them. The live board's ~1Hz remote-control poll (`app/board/page.tsx:452`) is a great first candidate for a genuine push channel since it's already the highest-frequency poll in the app, just scoped to one device per classroom.

### 6.2 Connection pooling becomes existential, not precautionary

What's "good practice" at 1,000 users is required at 50,000 — a transaction-mode pooler plus, likely, read replicas for the heavy read paths (library browsing, admin dashboards) so writes (notebook sync) aren't contending with reads on the same primary.

### 6.3 File egress

Once tens of thousands of students are pulling PDFs/PPTs, Vercel Blob's $0.05/GB transfer fee compounds. This is where **Cloudflare R2's zero-egress pricing** actually pays for itself — same S3-compatible API, so the migration from Blob is small if you built the storage layer behind a clean interface in §2.1 (do that now, even at phase-1 scale, so this swap is a config change later, not a rewrite).

### 6.4 Database compute

Move off autoscale-to-zero to a sized, always-warm tier (Neon Scale or equivalent) for predictable latency under sustained load, and start archiving/partitioning tables that grow unbounded — `simblip_board_sessions` and `simblip_submissions` are the ones that will actually accumulate over years of real usage (the file table stays bounded by design; these don't).

### 6.5 Rate limiting needs a real store

An in-memory limiter doesn't coordinate across the many Fluid Compute instances you'll have warm at 50,000-user traffic. Move to Upstash Redis or Vercel's Runtime Cache-backed counters.

### 6.6 Edge caching for read-heavy, rarely-changing data

Library assets, sketch templates, and public share pages are exactly the kind of content that should be served from Vercel's CDN/Runtime Cache and never touch Postgres on a normal read. This is a bigger lever at 50,000 users than at 1,000 — worth designing for once traffic data from the pilot shows which endpoints are actually hot.

### 6.7 AI, if you kept it

A single CPU box (§2.3 option B) does not serve concurrent generations at this scale. Either scale out GPU-backed serverless inference (pay-per-request, RunPod-style) behind the same `OLLAMA_HOST` contract, or route through **Vercel AI Gateway** to a hosted model API as a fallback/primary — trading infrastructure ops for per-token cost, which is often the simpler operational choice once you're past "one guy running a box."

### 6.8 Rough cost trajectory

Precise numbers here are genuinely speculative without real engagement data from the 1,000-user pilot — don't plan a budget off this, use the pilot's actual Vercel/Neon usage dashboards to extrapolate instead. Directionally: with §6.1–§6.6 addressed, expect low hundreds of dollars/month in the 5,000–15,000 user range, climbing toward **roughly $1,000–3,000+/month at a sustained, engaged 50,000 users**, driven mostly by database compute and file egress rather than Vercel hosting itself. Vercel Enterprise (support SLAs, higher included transfer, WAF/bot-management via Vercel Firewall) becomes worth evaluating once you're operating at that scale.

---

## 7. What to revisit once you have real pilot data

This plan is built on stated concurrency/traffic assumptions (§3.1), not measured ones. After 4–6 weeks of real 1,000-user traffic, pull actual numbers from the Vercel and Neon dashboards and re-run the budget — the biggest unknowns are (a) how many users actually keep a dashboard tab open long enough for the 4s poll to matter, and (b) how large notebook documents/attachments really run in practice. Both directly move the DB and Blob line items.

---

## Sources (pricing, as of Aug 2026 — verify at checkout, these move)

- [Vercel Pricing](https://vercel.com/pricing)
- [Neon Pricing](https://neon.com/pricing)
- [Vercel Blob pricing/docs](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- Cloudflare R2 pricing (public pricing pages, storage $0.015/GB-mo standard, $0 egress)
- Hetzner Cloud CPX-series pricing (public pricing page)
- RunPod serverless GPU pricing (public pricing page, [runpod.io/pricing](https://www.runpod.io/pricing))
