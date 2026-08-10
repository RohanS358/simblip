# Redis cache plan (30MB budget)

## Current state
- `lib/server/redis.ts`: one shared pub/sub pair per warm instance, free-tier Redis Cloud, 30MB, no persistence, 30 connections max.
- Used today for board-live pub/sub (`lib/server/board-live-bus.ts`, fire-and-forget, nothing stored) and device presence (`app/api/devices/route.ts`, TTL 180s keys, tiny strings). Real usage is well under 1MB — budget is basically untouched.
- No caching layer exists anywhere. `@tanstack/react-query` is in `package.json` but has zero `useQuery`/`QueryClient` call sites — an installed, unused dependency (ladder rung 5, use it before adding anything new — but see below on why this plan skips it).
- Every `/api/pg/[table]` GET hits Postgres live (`app/api/pg/[table]/route.ts:155`), no `Cache-Control`, no in-memory cache.

## Why server-side Redis, not client-side react-query
react-query would cache in each browser tab — it doesn't help the *server's* Postgres load, and doesn't help a second device or a fresh tab. The actual win available here is a shared server-side cache in front of the `/api/pg` gateway, which is one chokepoint all reads already go through (`app/api/pg/[table]/route.ts`). That's a different problem than client caching, so both can coexist later; this plan only covers the server side since that's what the 30MB Redis budget can do.

## Security constraint (non-negotiable)
`buildWhere()` (`app/api/pg/[table]/route.ts:92-133`) injects `owner_id`/`institution_id` scoping server-side from the JWT, not from the query string. **Cache keys must include `claims.sub` (and institution id for institution-scoped tables) — never just the query string** — or one user's cached response leaks to another user hitting the same URL.

Key shape: `pg:{table}:{claims.sub}:{queryString}`

## What to cache, and what not to

| Data | Cache? | Why |
|---|---|---|
| `simblip_profiles`, `simblip_institutions` | Yes | Tiny (<1KB), read on every app mount/login, rarely changes |
| `simblip_file_manifest` | Yes | Small metadata rows, read on every sync tick |
| `simblip_workspaces` (notebooks jsonb) | Yes, short TTL | Low-KB to tens of KB, changes on edit |
| `simblip_pages.content` | **No** | Can be hundreds of KB per page, and `pull()` fetches *every page in a workspace at once* (`lib/sync/cloud.ts:95`) — a handful of busy boards would blow the 30MB budget on their own. This is also the most write-heavy data (live editing), so hit rate would be poor anyway. |
| `simblip_room_members` | Yes | Small, read on every auth init |

Rough budget: profiles/institutions/manifest/room_members/workspaces across active users should sit in the low single-digit MB even at hundreds of concurrent users — leaves comfortable headroom under presence/pub-sub's negligible footprint.

## Implementation (smallest diff that works)
1. In `app/api/pg/[table]/route.ts`'s GET handler, for the allowlisted cacheable tables only (profiles, institutions, file_manifest, room_members, workspaces):
   - Build key `pg:{table}:{claims.sub}:{queryString}`.
   - `GET` from Redis first (reuse `getRedisPub()` — it's a plain client, GET/SET work fine on it despite the name; no second connection needed given the 30-connection ceiling).
   - On miss, run the existing query, `SET ... EX 30` (30s TTL — short enough that staleness after an edit is a non-issue, long enough to absorb the burst of reads on mount).
   - On the table's own POST/PATCH/DELETE handler, `DEL` any keys matching `pg:{table}:{claims.sub}:*` for that user (use a small per-user index set, not `KEYS`, same pattern `app/api/devices/route.ts` already uses for pruning — `SADD` the key name to `pg:{table}:{claims.sub}:__keys` on write, `SMEMBERS` + pipeline `DEL` + `DEL` the index itself on invalidation).
2. Nothing changes in `pages` handling — leave it uncached.
3. No new env vars, no new dependency, no client changes.

## Rollout check
- `demo()`-style check: hit `/api/pg/simblip_profiles?id=eq.X` twice as the same user, confirm second response is a Redis hit (add a `X-Cache: HIT/MISS` debug header behind `NODE_ENV !== 'production'` while testing, remove or leave — cheap enough either way) and that a PATCH followed by a GET returns fresh data, not the stale cached copy.

## Explicitly out of scope for this pass
- Caching `pages.content` — revisit only if profiling shows Postgres load from page reads is actually a bottleneck; premature given the size risk above.
- Client-side react-query — separate concern (perceived latency in a single tab), not blocked by this plan, can be added independently later since it doesn't touch the server.
