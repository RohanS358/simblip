# Security & reliability audit — 2026-09-30

Scope covered in this pass: the server surface (`app/api/*`, `lib/server/*`), the
Postgres schema and migrations, the dependency tree, and the test/build baseline.
Not covered: the client bundle, frontend performance, the canvas/simulation
engines. See "Not verified" at the end. Nothing was committed, pushed or deployed.

## Baseline (before changes)

| Check | Result |
|---|---|
| `*.test.mjs` files | 68 files, 66 passing. `lib/ai/pipeline.test.mjs` and `answer-formatting.test.mjs` failed to start (esbuild had no loader for KaTeX `.woff` fonts). |
| `tsc --noEmit` | 0 errors (yet `next.config.mjs` had `ignoreBuildErrors: true`) |
| `npm audit --omit=dev` | 12 vulnerabilities: 1 critical, 8 high, 3 moderate |
| Postgres server | Not available in this environment. No integration test, no EXPLAIN. |

## Findings and status

| ID | Pri | Finding | Status |
|---|---|---|---|
| S-01 | P0 | `/api/pg` enforced tenant scope only. Any signed-in user could `PATCH profiles?id=eq.<self> {"role":"admin"}` (or `super_admin`, which bypasses tenant scoping) because privileged claims are re-read from that row. POST is an upsert, so any user could also rewrite any profile. Students could edit or delete assignments, announcements, rooms, boards, other users' library assets, shares and sessions. | Fixed: `lib/server/pg-policy.ts`, default-deny per table, method and role, column allow-lists, forced ownership columns, scoped rows. |
| S-02 | P1 | Reads were tenant-wide: a student could read every classmate's submission, every share and every board session in the institution. | Fixed (read scopes). Responses with a per-caller filter are excluded from the tenant-shared Redis cache. |
| S-03 | P1 | `/api/web-proxy` followed redirects with `fetch(..., {redirect:'follow'})` after checking only the first hostname: a public 302 to `169.254.169.254` was followed. DNS-rebinding window. Unbounded body. | Fixed: `lib/server/safe-fetch.ts` (connect-time IP pinning, manual redirects, 25 MB cap). |
| S-04 | P1 | `isBlockedAddress` missed IPv4-mapped IPv6 in hex form (`::ffff:7f00:1`, which is what `new URL` produces), NAT64 and 6to4. Affected calendar fetch and the proxy. | Fixed and tested. |
| S-05 | P1 | `/api/files` served uploaded bytes with the uploader's `Content-Type` inline from our origin (stored XSS: sessions live in localStorage) and let any user write or delete any path. | Fixed: active types download-only, nosniff and sandbox CSP, writes limited to a session the caller presents, 50 MB cap. |
| S-06 | P1 | Board-live WebSocket: any role, including student followers, could send `obj-patch`/`bundle` and rewrite the presented board. No message size cap. | Fixed: only teacher/desktop/board edit; 5 MB cap; objectId validated. |
| S-07 | P1 | `/api/dev/db-ping` was unauthenticated and returned the DB host, port and raw login errors. | Fixed: operator only. |
| S-08 | P2 | Login limiter keyed on ip+email only (spray across emails, each costing a scrypt hash). Auth 500s echoed driver error text. Provisioning accepted any password, and a missing field became the password `"undefined"`. | Fixed: per-IP failure ceiling (100 per 15 min, failures only), generic 500, 8-character minimum on admin provisioning. |
| S-09 | P3 | `ignoreBuildErrors: true` with 0 type errors. | Fixed: set to false; `next build` passes with type checking on. |
| T-01 | P3 | Two AI tests could not run (missing font loaders). | Fixed. They now run and expose pre-existing failures (below). |
| D-01 | P2 | Missing indexes for the columns the new scopes and FK cascades hit. | Added as migration 004 (`db/migrations/004-policy-indexes.sql`, with `.down.sql`). **Hypothesis, not measured.** |

## Open: needs a decision

**S-10 (P0) Proxied pages run on SIMBLIP's own origin.** The Web tab iframe uses
`allow-scripts allow-same-origin`, and proxied HTML is served from our origin, so
any site opened in the Web tab can read `localStorage` (the access and refresh
tokens) and call `/api` as the user. The same-origin header check only stops
third-party links. Options:

1. Serve proxied responses with `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups` and drop `allow-same-origin`; add CORS `*` and accept a same-origin `Referer` in `fromOwnPage`. Fixes it, but sites whose own scripts use `localStorage` or cookies will break.
2. Move the proxy to a separate registrable origin. The proper fix; needs DNS and infrastructure.
3. Move tokens to httpOnly cookies. A large refactor; it also removes the localStorage exposure to any future XSS.

Not changed here because it alters product behavior. Recommendation: (1) short term, (2) long term.

## Open: not fixed

- P2 `sketch_templates` accepts anonymous POST and any-user DELETE (the shared recognizer dataset can be poisoned). Needs a `contributor_id` column and moderation.
- P2 Refresh tokens last 30 days with no rotation or revocation; a password reset does not invalidate them. Non-privileged roles trust the token for up to 1 h after deactivation.
- P2 Profiles are readable tenant-wide (everyone's email in the institution); assignments likewise.
- P2 `/api/files` allows writes under a session UUID that does not exist yet (the client uploads before creating the session row). Bounded by the 3 h sweep; add a per-user cap if abused.
- P2 Dependencies (`npm audit`): `next@16.0.10` (the advisory is the Image Optimizer, not reachable with `images.unoptimized`; upgrading needs testing), `xlsx` (prototype pollution and ReDoS, no npm fix; parses user-uploaded files client-side), `pptxgenjs`, `pptx-preview` (via `uuid`), `@vercel/config` (build-time only). Nothing was auto-upgraded.
- P2 Pre-existing failures now visible in `lib/ai/pipeline.test.mjs`: a training-corpus sample ("Add a slider that controls the mass…") fails the project's own linter (`/api/train/simscript` promises linted samples), and the inline-maths rendering test expects 2 blocks and gets 0.
- P3 Cursor and viewport WebSocket messages have no rate limit.

## Verification actually run

- `node --experimental-strip-types lib/server/pg-policy.test.mjs`: passes (authorization matrix, escalation cases, scopes, read filters).
- `lib/server/safe-fetch.test.mjs`: passes (schemes, credentials, loopback, private, metadata and IPv6 literals). Redirect-hop revalidation is not covered by a hermetic test.
- `lib/server/calendar-fetch.test.mjs`: passes, including the new IPv6-embedded cases.
- All 70 `*.test.mjs` files: 69 pass, 1 fails (`pipeline.test.mjs`, the 2 pre-existing assertions above).
- `tsc --noEmit`: 0 errors. `next build`: succeeds with type checking enforced.

**Not verified:** the gateway policy against a live database (no Postgres server here); end-to-end classroom flows in a browser after the policy change (present with a document, submit, review, approve a library asset); migration 004 on real data; any performance claim; frontend performance and the client bundle. Do the first three before deploying.

## Files changed

New: `lib/server/pg-policy.ts` (+ test), `lib/server/safe-fetch.ts` (+ test), `db/migrations/004-policy-indexes.sql` and `.down.sql`.

Modified: `app/api/pg/[table]/route.ts`, `app/api/web-proxy/[...path]/route.ts`, `app/api/files/[...path]/route.ts`, `app/api/board-live/[sessionId]/route.ts`, `app/api/dev/db-ping/route.ts`, `app/api/auth/route.ts`, `app/api/admin/provision/route.ts`, `lib/server/auth.ts`, `lib/server/calendar-fetch.ts` (+ test), `db/schema.sql`, `next.config.mjs`, `lib/ai/pipeline.test.mjs`, `lib/ai/answer-formatting.test.mjs`.

## Behavior changes to be aware of

- Non-operator writes to `/api/pg` now follow the role table; a method not listed for a listed table is 403.
- Students no longer receive other students' submissions or unapproved library assets from the API.
- Institution admins must give passwords of 8+ characters when creating people and boards and when resetting.
- Files at `/api/files` that declare an HTML, SVG or JS type download instead of rendering.
- Teachers cannot publish a library asset as already approved (the client never did).
