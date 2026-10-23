# Security remediation, October 2026 (audit item 1)

Fixes for the first batch of findings from the S0–S6 audit. Every fix has a regression test; the tests were
checked to fail against the code they replaced where that was practical.

## 1. Photo reader denial of service

**Problem.** `mergeThroughJunctions` (`lib/sketch/photo/trace.ts`) re-scanned every pair of line ends after each
join, so cost grew roughly cubically. A 400×300 grid took 18.5 s; a 1600×1100 photo of graph paper ran for minutes.
When the worker hit its timeout, `read-client.ts` re-ran the same work on the page's thread (freezing the tab) and
left the stuck worker running behind every later read.

**Fix.**
- Joiner rewritten (spatial hash + heap): same results as before (stroke counts within ±2 on 17 test pictures),
  about 100–470 ms on the same grids.
- `lib/sketch/photo/budget.ts`: limits (more than 1200 line pieces, or more than 300 strokes after joining, is
  refused as "graph paper / busy scene") and a deadline that stops the work wherever it is (default 10 s; the worker
  gives itself 12 s, the page-side fallback 4 s). A refusal is a plain message, never a raw error.
- `lib/sketch/read-client.ts`: a worker that is too slow is **terminated**, every read waiting on it is answered with
  a "took too long" failure, and the read is **not** repeated on the page thread. The next request starts a fresh
  worker. Only a worker that cannot run at all (no `Worker`, script failed) falls back to this thread.

Tests: `lib/sketch/photo/photo.test.mjs` (graph paper, scribble page, deadline, joiner), `lib/sketch/read-client.test.mjs`.

**Not changed (audit item 9):** the ink reader still has no cap on points per stroke (one 200k-point stroke took
30 s). The worker timeout now contains it, but a cap on ingestion is still needed.

## 2. `/api/ai` authentication, rate limit, model choice

**Problem.** `app/api/ai/route.ts` answered anyone, had no limit, and passed a client-chosen `model` to OpenRouter
with the server's key.

**Fix** (`lib/server/ai-guard.ts`, used by `/api/ai` and `/api/ai/models`):
- cloud deployment (`DATABASE_URL` set): a valid **access** token is required (same token as `/api/pg`; a refresh
  token or a forged one is refused); the client now sends it (`lib/ai/auth-header.ts`) and shows "Sign in again" /
  "Too many requests" instead of failing to parse a stream;
- local deployment (no database): only requests that arrive as localhost (and were not forwarded) are served;
- per caller: 20 requests a minute, 300 an hour, 2 at once, 256 KB body. Redis-backed when `REDIS_URL` is set
  (shared across instances), in memory otherwise (per instance);
- `model`: on a cloud deployment only the allow-list and the configured default are honoured (admins: any
  well-formed name); the model picker lists only what the server will accept.

`nocache` was already ignored in production (`cachedGenerator`); I had reported it as a hole and that was wrong.

**Configuration.**

| variable | default | meaning |
|---|---|---|
| `AI_RATE_PER_MIN` / `AI_RATE_PER_HOUR` | 20 / 300 | per-caller limits |
| `AI_MAX_CONCURRENT` | 2 | requests in flight per caller |
| `AI_MODEL_ALLOWLIST` | (empty) | comma-separated model names students may pick, besides `OPENROUTER_MODEL` |
| `AI_ALLOW_ANONYMOUS=1` | off | serve a local install to non-localhost clients (trusted LAN / demo only) |
| `AI_TOKEN` | – | for `scripts/ai-sweep.mjs` against a cloud deployment |

**Behaviour changes to know about.** A local install reached from another device (a phone on the LAN) now gets 403
unless `AI_ALLOW_ANONYMOUS=1`. Signed-out users on a cloud deployment can no longer use the server AI lane (the
on-device model is unaffected).

Tests: `lib/server/ai-guard.test.mjs` (guard + the real route handlers).

## 3. `sketch_templates`

**Problem.** The gateway allowed anonymous `GET` and `POST`, and (being outside the policy table) any signed-in user
could also read, edit or delete every row. `lib/sketch/custom.ts` also uploaded a person's old local examples to
that table silently.

**Fix.**
- no anonymous access to any method;
- `pg-policy.ts`: `POST` for admin/teacher/student, stamped with the author (`contributor`, forced), name /
  component / cloud shape and a 60 KB size limit; `PATCH` admin only; `DELETE` own rows (admins: any);
- reads: the library from before this change (rows with no contributor) stays shared; newer rows are visible only to
  their author (admins see all);
- `custom.ts`: on a cloud deployment legacy browser-stored examples are **kept on the device** (still used for
  matching) instead of being uploaded.

**Migration.** None required for the schema. Existing rows have `contributor` null and stay readable by every signed-in
user (as before, but no longer anonymous). Decide whether to delete or review that legacy set. If you want
cross-user sharing of NEW examples within an institution, add an `institution_id` column and scope reads by it; that
was not done here.

Tests: `lib/server/pg-policy.test.mjs`, `lib/server/sketch-templates-gateway.test.mjs` (fails on the old gateway).

## 4. Dependencies

`npm audit --omit=dev`: 15 vulnerabilities (1 critical, 9 high) before, **0 after**.
- `next` 16.0.10 → 16.4.2 (also removes the nested postcss and sharp findings); `eslint-config-next` to match;
- `xlsx` 0.18.5 (abandoned on npm, two open CVEs) → SheetJS's own maintained build 0.20.3, installed from
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (same API: no code change; `.xls` and `.csv` still read);
- `katex` 0.17 → 0.19; `overrides` for `image-size` ^2.0.4, `uuid` ^11.1.1, `echarts` ^6.1.0 (under `pptxgenjs` and
  `pptx-preview`);
- `@vercel/config` moved to devDependencies (build-time only).

`npm run audit:prod` fails on any high finding. Remaining (8, all dev-only, build/lint tooling): `braces`,
`micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`, `path-to-regexp`,
`@vercel/routing-utils`, `@vercel/config`. None runs in the product.

**Supply-chain note.** The CDN tarball sits outside the npm registry; `package-lock.json` pins its integrity hash.
Re-verify the hash when upgrading. Test: `lib/store/xlsx-safe.test.mjs`.

## Tests now run by `npm run test:ai`
`lib/server/*.test.mjs` (including the previously unrun `pg-policy` authorization tests) and
`lib/store/xlsx-safe.test.mjs` were added to the script; before this, nothing ran them.
