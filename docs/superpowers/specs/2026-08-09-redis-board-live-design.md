# Redis for board-live: pub/sub, presence, and desktop cursor mirroring

Date: 2026-08-09

## Context

`app/board` / `app/present` already implement a real-time whiteboard feature
("board-live"): a teacher presents a page to a physical room board, students
optionally get a synced copy, and everyone's object edits fan out live over a
WebSocket (`app/api/board-live/[sessionId]/route.ts`). Cross-instance fan-out
today rides Postgres `LISTEN`/`NOTIFY` (`lib/server/board-live-bus.ts`), which
has two problems: it holds one dedicated `pg.Client` LISTEN connection open
per warm Fluid Compute instance, and `NOTIFY` payloads are capped at ~8KB, so
large patches already fall back to a `resync` signal + REST re-pull.

Separately, `lib/sync/devices.ts` maintains "who's online" presence by
writing a heartbeat row to Postgres (`simblip_devices`) every 15 seconds per
open tab, and `app/board/page.tsx` polls every 1.1–4s as a fallback path when
the WebSocket is down.

The user has provisioned a free-tier Redis Cloud database: 30MB, no
persistence, no HA, **30 connections max**. This design replaces the
Postgres-based fan-out and presence mechanisms with Redis, and adds a new
desktop-live mode: the teacher's own desktop workspace can drive a board
session directly (not just the existing phone-remote command panel), with
live cursor mirroring in both directions.

No AI/Ollama work is in scope here — that was explicitly deferred by the
user in this conversation.

Additionally, presenting today is locked to the teacher who started the
session: `authorizeBoardSession` (`lib/server/board-session-auth.ts:38`)
grants `as: 'teacher'` only when `claims.sub === session.teacher_id`, and
`/present`'s picker phase (`app/present/page.tsx:128`) sends anyone with
`role === 'student'` straight to view-only mode, never offering them the
"pick a page and Present" screen. The user wants this opened up: **when a
board is free (no live session), anyone who scans becomes a presenter
candidate**, not just a pre-designated teacher — and the reverse, once
someone IS presenting, the board's QR should default to a closed/non-
scannable state so the room doesn't get a second person trying to grab an
already-live board.

## Goal 5 (added): open presenting + closed-while-live QR

- **Free-to-present.** Any authenticated member of the room (teacher or
  student role — anyone who can currently resolve the pairing at all) sees
  the "pick a page and Present" screen when the board has no live session,
  not just users the session was pre-assigned to. `startSession` already has
  no owner restriction (`lib/data/boards.ts:44`); the gate to remove is in
  `/present`'s client-side phase logic
  (`useAuthStore.getState().profile?.role === 'student'` short-circuit at
  `app/present/page.tsx:128`), which should instead branch on **session
  liveness**, not caller role: no live session → show the picker to anyone;
  live session already running → straight to viewer/follow mode for anyone
  who isn't that session's `teacher_id`.
- **`authorizeBoardSession` stays role-based, not identity-based, for the
  WS.** Once a session exists, whoever started it (`session.teacher_id`) is
  the `'teacher'` for that session's WS purposes (drives `RemotePanel`,
  desktop-live, etc.) — this doesn't change; "anyone can present" only means
  anyone can be the one to *start* the next session on a free board, not
  that multiple people co-drive the same live session as equals.
- **Closed QR while live — derived, no new column.** "Closed" is not new
  persisted state: it's `liveSessionFor(board.id)` returning non-null
  (`lib/data/boards.ts:81`, already exists, already queried by the board
  itself in `syncSession`). No `qr_open` column, no schema migration, no
  extra write path. "Closed" specifically means: the board stops
  *displaying/offering* a scannable QR for starting a new presentation —
  it does NOT mean `resolvePairing` rejects the scan outright, because a
  live board's QR must keep resolving for viewers (any role) to join as
  followers. `app/board/page.tsx`'s render already gates the whole
  idle-vs-live layout on `activeBoardPage` (truthy only when a session is
  live or a local scratch pad is open), so the QR card simply never renders
  during a live session — no new gating needed there, it was already
  correct. `/present`'s phase logic is what actually enforces "closed to
  new presentations": resolving a pairing now always checks
  `liveSessionFor` first — live → straight to viewer/follow mode for
  everyone (existing `classLive` flow, now reachable by any role, not just
  `role === 'student'`); free → the picker screen, open to whoever scans
  first.
- This is a permissions/UX change, not a Redis concern — no new Redis usage
  is introduced by this goal. It's bundled into this spec because it lands
  in the same files (`app/present/page.tsx`, `app/board/page.tsx`,
  `lib/data/boards.ts`) as the desktop-live work above and the user asked
  for it in the same implementation pass.

## Goals

1. Replace Postgres LISTEN/NOTIFY with Redis pub/sub for board-live fan-out,
   removing the 8KB payload ceiling and the per-instance dedicated DB
   connection.
2. Replace the Postgres device-heartbeat/presence mechanism with Redis TTL
   keys.
3. Add a new **desktop-live** mode: a teacher's desktop browser tab can act
   as a live-driving peer on a board session (in addition to, not replacing,
   the existing phone-remote panel), with cursor position mirrored
   bidirectionally between desktop and board.
4. Size the Redis usage so the system comfortably survives ~1000 concurrent
   clients across ~20 concurrent boards on the free 30MB/30-connection tier,
   as an infra headroom target — not an enforced hard cap in code.

## Non-goals

- No AI/Ollama caching or rate limiting.
- No hard enforcement of the 20-board / 1000-client ceiling (no code that
  rejects the 21st board or 51st client).
- No change to the existing phone-remote (`RemotePanel` in
  `app/present/page.tsx`) command model — desktop-live is additive.
- No student cursor broadcasting — only the actively "driving" peer(s)
  (teacher desktop, board) send cursor position.
- Object-edit sync (`obj-patch`) already flows both ways today; this design
  does not change that mechanism, only what carries it (Redis instead of
  Postgres NOTIFY) and adds a cursor layer alongside it.

## Design

### 1. Redis pub/sub replacing Postgres LISTEN/NOTIFY

`lib/server/board-live-bus.ts` keeps its existing shape (a `globalThis`-
stashed singleton bridge, local-socket fan-out first, cross-instance second)
but swaps the transport:

- Add `ioredis` as a dependency.
- One shared **subscriber** connection and one shared **publisher**
  connection per warm instance, stashed on `globalThis` exactly like the
  current `bridge.listener` — not one pair per board session. This is the
  binding constraint on the free tier: 30 max connections total across every
  warm instance, so per-instance connection count must stay fixed at 2
  regardless of how many sessions or sockets that instance is serving.
- The subscriber subscribes to a single fixed channel (e.g.
  `simblip:board-live`) for all sessions, matching today's single-channel
  `simblip_board_live` NOTIFY approach; messages carry `{ sessionId, evt }`
  and are filtered/dispatched to local sockets by `sessionId` exactly as
  today's `fanOutLocal` does.
- `publish()` drops the byte-size branch — Redis pub/sub has no realistic
  payload ceiling for this use case, so full `obj-patch`/`bundle` payloads
  always go out directly. The `resync` message type stays in
  `board-live-types.ts` for genuine drift/reconnect cases, but is no longer
  triggered by payload size.
- `ensureBoardLiveListener()` becomes `ensureRedisSubscribed()` (or is kept
  as the same exported name to minimize call-site churn) — connects lazily,
  same guard-against-concurrent-connect pattern as today's `connecting`
  promise.
- `DATABASE_URL_DIRECT` and the dedicated LISTEN `pg.Client` are removed
  from this file once the swap is verified working; the pooled `q()` publish
  path is replaced by `redis.publish()`.

### 2. Device presence via Redis TTL keys

`lib/sync/devices.ts`'s `touch()` currently POSTs to `/api/pg/simblip_devices`
every 15 seconds. Replace the underlying storage for presence with Redis:

- A small server route (or extending an existing `/api/pg`-adjacent route)
  does `SET device:{ownerId}:{deviceId} <label> EX 180` on heartbeat,
  matching the existing `FRESH_WINDOW_MS` (3 minutes).
- "Who's online" (`components/workspace/sync-status.tsx`'s device list)
  reads via `KEYS device:{ownerId}:*` or (better, to avoid `KEYS` in
  production) a small Redis Set of active device ids per owner, refreshed
  alongside the TTL key.
- This removes the per-tab 15s Postgres write-storm entirely; presence
  becomes ephemeral by construction (no persistence needed, no cleanup job
  needed — keys expire on their own).
- The existing local-mode fallback (`db.insert` into a local `devices`
  table when the fetch fails) is untouched — this only changes the
  cloud-mode path.

### 3. Desktop-live mode with bidirectional cursor mirroring

**New role.** `BoardLiveRole` gains `'desktop'` alongside
`'teacher' | 'board' | 'student'` in `lib/data/board-live-types.ts`. A
desktop-live peer authenticates and connects to the same
`app/api/board-live/[sessionId]` WebSocket route the board and phone already
use — no new route, no new auth path, reusing `authorizeBoardSession`.

**New message type**, added to both `BoardLiveClientMsg` and
`BoardLiveServerMsg`:

```ts
{ type: 'cursor'; x: number; y: number; pageId: string }
```

Semantics:
- Only sent by whichever peer is actively driving — the teacher's desktop
  tab and the board itself. Students never send `cursor` (confirmed with
  user: most students are passive viewers; broadcasting 50 cursors per
  board would blow the free-tier message budget for no product value).
- `cursor` messages are **never persisted to Postgres** — they bypass the
  `simblip_board_sessions` update entirely and go straight to
  `publish(sessionId, evt, socket)` in `board-live-bus.ts`, same local+Redis
  fan-out path `obj-patch` uses, just skipping the `q()` write.
- Client-side throttling: the sender coalesces mouse-move events and flushes
  at most once per 100ms (10/sec), always sending the latest known position
  (never queues intermediate positions) — implemented as a simple
  trailing-throttle in the desktop-live client hook, not a new dependency.
- Receivers render the peer's cursor as a small overlay (label + dot)
  positioned in the shared canvas coordinate space, faded out if no update
  arrives for ~2s (peer likely disconnected or idle).

**Bidirectionality.** Both desktop and board run the same client transport
(`lib/data/board-live-client.ts`'s `connectBoardLive`/`useBoardLive`, already
role-agnostic) — desktop sends `cursor` + relies on existing `obj-patch` for
edits; board does the same. Each renders whatever cursor event it receives
from the other. This reuses 100% of the existing bidirectional `obj-patch`
sync for content; `cursor` is purely an additive overlay layer.

**Where desktop-live is entered.** A new small entry point (exact UI TBD at
implementation-plan time, likely a "Drive this board from desktop" toggle
reachable from a live board session's page, distinct from `/present`'s
phone-oriented picker flow) — connects `useBoardLive` with `role: 'desktop'`
against the session already live on the board, rather than the phone's
pick-a-page-and-start flow. This is additive: `/present`'s existing
phone-remote command flow (`RemotePanel`) is untouched.

### 4. Capacity sizing (infra headroom, not enforced)

Target: ~1000 concurrent clients across ~20 concurrent live boards
(≈50 clients/board average), sized against the free tier's real limits
(30MB memory, 30 connections, no persistence) — verified, not guessed:

- **Connections**: fixed at 2 per warm serverless instance (1 subscriber + 1
  publisher, shared across all sessions on that instance) — independent of
  client count or board count, so this stays far under the 30-connection cap
  regardless of scale within reason.
- **Memory**: pub/sub messages are transient and never stored. Only
  standing state in Redis is device-presence keys (~1000 clients × one small
  key each, TTL 180s) — a few hundred KB at most, negligible against 30MB.
- **Message volume**: object-edit fan-out is occasional/human-paced
  (existing behavior, unchanged). Cursor messages are the new load: at most
  2 active cursors per board (teacher desktop + board) × 10/sec × 20 boards
  = 400 messages/sec peak system-wide, each a small JSON payload — well
  inside free-tier pub/sub throughput.
- No code enforces the 20-board/50-client ceiling; if usage grows past this
  envelope, the free tier's own connection/memory limits will surface first
  as Redis errors, at which point upgrading the Redis plan is the fix, not
  new guard code.

## Error handling / degradation

- If Redis is unreachable, `ensureRedisSubscribed()` throws the same way
  `ensureListener()` does today — the WS route logs and the client's
  existing reconnect-with-backoff (`connectBoardLive`) plus REST poll
  fallback (`app/board/page.tsx`'s `pollRemote`) keep the feature usable in
  degraded form, exactly as today's design already tolerates WS drops.
- Cursor messages are fire-and-forget UI sugar — if a `publish()` fails for
  a cursor event specifically, it's dropped silently (no retry, no resync
  trigger), since a stale/missing cursor position is a non-issue that
  self-heals on the next 100ms tick.

## Testing

- Manual verification: two browser sessions (desktop + simulated board) on
  a live session — confirm `obj-patch` still round-trips correctly over the
  new Redis-backed publish path, confirm cursor overlay appears/moves/fades
  correctly in both directions.
- Verify Redis connection count stays at 2 per instance under multiple
  concurrent board sessions on the same warm instance (log or inspect via
  Redis Cloud's connection metrics).
- Confirm presence keys expire correctly (device disappears from the online
  list ~3 minutes after a tab closes, without any explicit sign-off call).
