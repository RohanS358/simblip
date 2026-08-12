import { NextResponse } from 'next/server'
import { castFor, encodeValue, ident, pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims, type Claims } from '@/lib/server/auth'
import { publish } from '@/lib/server/board-live-bus'
import { cacheGet, cacheInvalidate, cacheSet, redisConfigured } from '@/lib/server/redis'
import type { BoardLiveServerMsg } from '@/lib/data/board-live-types'
import type { BoardSessionStatus, RemoteCommand } from '@/lib/data/types'

// Data gateway (replaces Supabase PostgREST). Speaks the exact query dialect
// the client data layer already uses:
//
//   GET    /api/pg/simblip_rooms?select=id,name&institution_id=eq.<uuid>
//   POST   /api/pg/simblip_pages            (array of rows; upsert on pk)
//   PATCH  /api/pg/simblip_boards?id=eq.<uuid>   (body = partial row)
//   DELETE /api/pg/simblip_pages?id=eq.x&workspace_id=eq.y
//
// Security model (replaces RLS):
//   • Every table except sketch_templates requires a valid access JWT.
//   • Tenant isolation is enforced server-side: non-operator callers are
//     hard-scoped to their own institution on reads and writes.
//   • Workspaces/pages are additionally hard-scoped to their owner.
//   • profiles.password_hash never crosses this boundary in either direction.

interface TableSpec {
  pk: string[]
  /** anonymous access: which methods are open without a JWT */
  anon?: string[]
  /** extra owner scoping: column that must equal the caller's user id */
  owner?: string
}

const TABLES: Record<string, TableSpec> = {
  institutions: { pk: ['id'] },
  profiles: { pk: ['id'] },
  rooms: { pk: ['id'] },
  room_members: { pk: ['room_id', 'profile_id'] },
  boards: { pk: ['id'] },
  board_sessions: { pk: ['id'] },
  workspaces: { pk: ['id'], owner: 'id' },
  pages: { pk: ['id'], owner: 'workspace_id' },
  shares: { pk: ['id'] },
  library_assets: { pk: ['id'] },
  library_favorites: { pk: ['asset_id', 'profile_id'] },
  assignments: { pk: ['id'] },
  submissions: { pk: ['id'] },
  announcements: { pk: ['id'] },
  sketch_templates: { pk: ['id'], anon: ['GET', 'POST'] },
  file_manifest: { pk: ['id'], owner: 'owner_id' },
  // SECURITY: `devices` used to allow anonymous GET/POST/PATCH/DELETE. With
  // no claims the scoping block in buildWhere is skipped entirely, so
  // ?owner_id=eq.<anyone> read — or deleted — any user's device rows without
  // a token. Every client call (lib/sync/devices.ts, device-file-sync.ts)
  // already sends a Bearer token, so requiring auth costs nothing.
  devices: { pk: ['id'], owner: 'owner_id' },
  // Bug reports: any signed-in user can file one (POST) and read back their
  // own (the owner scope below narrows GET to reporter_id = you). The /dev
  // console reads every report — it authenticates as an operator, and
  // isOperator() skips both the tenant and owner scopes.
  bug_reports: { pk: ['id'], owner: 'reporter_id' },
}

// Tables that carry institution_id on the row and must stay inside the
// caller's tenant. Join tables (room_members, library_favorites) have no
// institution_id column — they are scoped via parent rows instead.
const TENANT_COLUMN = new Set(
  Object.keys(TABLES).filter(
    (t) => !['institutions', 'sketch_templates', 'room_members', 'library_favorites'].includes(t)
  )
)

// Still tenant-isolated, but isolation is applied via a parent-table subquery
// (see buildWhere). Membership is optional: zero rows is a valid result.
const JOIN_TABLE_SCOPE: Record<string, (paramIndex: number) => string> = {
  room_members: (i) =>
    `room_id in (select id from simblip_rooms where institution_id = $${i})`,
  library_favorites: (i) =>
    `asset_id in (select id from simblip_library_assets where institution_id = $${i})`,
}

interface Ctx {
  table: string
  spec: TableSpec
  claims: Claims | null
}

/**
 * Roles that grant more than an ordinary user, and so must be confirmed
 * against the database rather than taken from the token. `super_admin`
 * bypasses tenant scoping entirely; `board` skips owner scoping.
 */
const PRIVILEGED_ROLES = new Set(['super_admin', 'admin', 'board'])

async function resolve(
  req: Request,
  tableParam: string,
  method: string
): Promise<Ctx | NextResponse> {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const table = tableParam.replace(/^simblip_/, '')
  const spec = TABLES[table]
  if (!spec) return NextResponse.json({ error: 'Unknown table' }, { status: 404 })
  const claims = bearerClaims(req)
  if (!claims && !spec.anon?.includes(method)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // SECURITY: role came straight from the JWT, so a demoted or deactivated
  // admin kept operator powers for the life of their token — up to 30 days,
  // with no revocation path. Privileged claims are now re-read from the
  // profile on every request; ordinary users cost no extra query, since
  // their role grants nothing beyond what owner/tenant scoping already
  // allows. The provisioning routes have always done this — /api/pg didn't.
  if (claims && PRIVILEGED_ROLES.has(claims.role)) {
    const row = (
      await q<{ role: string; active: boolean; institution_id: string | null }>(
        'select role, active, institution_id from simblip_profiles where id = $1',
        [claims.sub]
      )
    )[0]
    if (!row?.active) return NextResponse.json({ error: 'Account unavailable' }, { status: 401 })
    // Trust the DB, not the token, for both role and tenant.
    claims.role = row.role
    claims.inst = row.institution_id
  }

  return { table, spec, claims }
}

const isOperator = (c: Claims | null) => c?.role === 'super_admin'

// Small (<1KB-to-tens-of-KB), read-heavy-on-mount, low-write-frequency
// tables only. `pages.content` (whiteboard/doc payload) is deliberately
// excluded: it can be hundreds of KB per row and a single workspace pull
// fetches every page at once, which would blow the 30MB Redis budget for
// poor hit-rate given how often boards get edited. See docs/redis-cache-plan.md.
const CACHEABLE_TABLES = new Set(['profiles', 'institutions', 'file_manifest', 'room_members', 'workspaces'])

const PLATFORM_INSTITUTION = 'inst-platform'

/** where-clause from ?col=eq.v / ?col=is.null filters + enforced scoping. */
function buildWhere(ctx: Ctx, url: URL): { clause: string; params: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []

  const { claims: reqClaims } = ctx
  const scopedCol =
    ctx.table === 'institutions' ? 'id' : TENANT_COLUMN.has(ctx.table) ? 'institution_id' : null

  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'select' || k === 'order' || k === 'limit' || k === 'offset') continue
    const col = ident(k)
    if (col === 'password_hash') throw new Error('Forbidden column')
    // Reject a client filter that tries to pin a scoped column to someone
    // else's value. The unconditional scope below would already reduce this
    // to "no rows", but failing loudly beats silently returning an empty list
    // — and it makes the attempt visible rather than looking like no data.
    if (
      reqClaims &&
      !isOperator(reqClaims) &&
      reqClaims.inst &&
      col === scopedCol &&
      v.startsWith('eq.') &&
      v.slice(3) !== reqClaims.inst
    ) {
      throw new Error('Cross-tenant filter rejected')
    }
    if (v === 'is.null') parts.push(`${col} is null`)
    else if (v.startsWith('eq.')) {
      params.push(v.slice(3))
      parts.push(`${col} = $${params.length}`)
    } else if (v.startsWith('gt.')) {
      params.push(v.slice(3))
      parts.push(`${col} > $${params.length}`)
    }
  }

  const { table, spec, claims } = ctx

  // SECURITY: scoping is UNCONDITIONAL. It used to be skipped whenever the
  // client had already sent that column ("!explicitCols.has(...)"), which
  // meant supplying the filter yourself REMOVED the guard:
  //   ?institution_id=eq.<other-tenant>  → read another institution's rows
  //   ?workspace_id=eq.<other-user>      → read another user's pages
  // Both scopes are now always AND-ed on top of whatever the client asked
  // for, so a client filter can only ever NARROW the result set, never widen
  // it. A client value for a scoped column is rejected outright above.
  if (claims && !isOperator(claims)) {
    if (table === 'institutions') {
      if (claims.inst) {
        params.push(claims.inst)
        parts.push(`id = $${params.length}`)
      }
    } else if (TENANT_COLUMN.has(table)) {
      if (claims.inst) {
        params.push(claims.inst)
        parts.push(`institution_id = $${params.length}`)
      }
    } else if (JOIN_TABLE_SCOPE[table]) {
      if (claims.inst) {
        params.push(claims.inst)
        parts.push(JOIN_TABLE_SCOPE[table](params.length))
      }
    }
    // `role: 'board'` is a shared kiosk identity: it legitimately reads pages
    // it does not own, and is constrained by institution + the board-session
    // authorization in lib/server/board-session-auth.ts instead.
    if (spec.owner && claims.role !== 'board') {
      params.push(claims.sub)
      parts.push(`${spec.owner} = $${params.length}`)
    }
  }
  return { clause: parts.length ? ` where ${parts.join(' and ')}` : '', params }
}

/** Ceiling for a request that didn't ask for a limit of its own. Far above a
 *  legitimate workspace, low enough that a runaway query can't scan a table. */
const MAX_ROWS = 2000
/** Ceiling for an explicit ?limit= — a caller can page, not dump. */
const MAX_EXPLICIT_LIMIT = 5000

/**
 * ORDER BY / LIMIT / OFFSET from the query string.
 *
 * These are interpolated into SQL (Postgres won't parameterize an identifier
 * or a sort direction), so the column goes through `ident()` and the
 * direction is matched against a fixed pair. Limit and offset are coerced to
 * non-negative integers — never passed through as strings.
 */
function buildTail(table: string, url: URL): { sql: string; truncatedAt: number | null } {
  let sql = ''

  const order = url.searchParams.get('order')
  if (order) {
    // PostgREST dialect: "col" | "col.asc" | "col.desc"
    const [rawCol, dir] = order.split('.')
    const col = ident(rawCol.trim())
    sql += ` order by ${col} ${dir === 'desc' ? 'desc' : 'asc'}`
  }

  const rawLimit = url.searchParams.get('limit')
  const explicit = rawLimit !== null ? Math.floor(Number(rawLimit)) : NaN
  const limit =
    Number.isFinite(explicit) && explicit > 0
      ? Math.min(explicit, MAX_EXPLICIT_LIMIT)
      : MAX_ROWS
  sql += ` limit ${limit}`

  const rawOffset = url.searchParams.get('offset')
  const offset = rawOffset !== null ? Math.floor(Number(rawOffset)) : NaN
  if (Number.isFinite(offset) && offset > 0) sql += ` offset ${offset}`

  // Only an implicit ceiling counts as "possibly truncated" — an explicit
  // limit is the caller getting exactly what they asked for.
  void table
  return { sql, truncatedAt: rawLimit === null ? limit : null }
}

const stripSecrets = (rows: Record<string, unknown>[]) =>
  rows.map(({ password_hash: _ph, ...rest }) => rest)

/**
 * Messages this gateway raises itself. These are safe to return: they
 * describe the caller's own request, not the database.
 */
const SAFE_ERRORS = new Set([
  'Forbidden column',
  'Cross-tenant filter rejected',
  'Refusing unfiltered update',
  'Refusing unfiltered delete',
  'Room is outside your institution',
  'Asset is outside your institution',
])

/**
 * SECURITY: raw driver errors used to be returned verbatim, handing clients
 * column names, constraint names, type details and fragments of our schema —
 * a free map of the database for anyone probing it. Our own validation
 * messages still pass through (they're about the request, and callers need
 * them); everything else becomes a generic message and is logged server-side
 * where it's actually useful for debugging.
 */
function errorResponse(err: unknown, table: string, method: string): NextResponse {
  const msg = err instanceof Error ? err.message : String(err)
  if (SAFE_ERRORS.has(msg) || msg.startsWith('Bad identifier:')) {
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  console.error(`[pg] ${method} ${table} failed:`, err)
  // The generic message above is right for the body text, but returning
  // NOTHING identifying made a live 400 undiagnosable from the browser: every
  // failure looked identical, and the only real detail sat in a server log
  // nobody can read from a phone. A Postgres SQLSTATE is a fixed five-char
  // code from a published list — it names the failure class (42703 undefined
  // column, 22P02 bad input syntax, 57014 timeout, 53300 too many
  // connections) without exposing any column, constraint, or value. Status
  // codes also get split out: a connection/timeout failure is ours (503), not
  // the caller's malformed request (400).
  const code = typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : undefined
  // Connection-level failures are server problems — a client retry is
  // meaningful, and a 400 tells it (wrongly) that retrying is pointless.
  const serverSide = code === '57014' || code === '53300' || code === '08006' || code === '08003'
  return NextResponse.json(
    { error: 'Request failed', ...(code ? { code } : {}) },
    { status: serverSide ? 503 : 400 }
  )
}

type Params = { params: Promise<{ table: string }> }

export async function GET(req: Request, { params }: Params) {
  const ctx = await resolve(req, (await params).table, 'GET')
  if (ctx instanceof NextResponse) return ctx
  try {
    const url = new URL(req.url)
    // claims.sub scoping is what makes this cache safe to share across
    // requests: buildWhere() enforces owner/tenant filtering server-side
    // from the JWT, so two different users hitting the identical query
    // string can get different rows — the cache key must reflect that.
    const cacheable = redisConfigured && CACHEABLE_TABLES.has(ctx.table) && ctx.claims
    // Debug-only visibility into hit/miss — harmless in prod (just an extra
    // response header) but cheap to drop entirely later if unwanted.
    const cacheHeader = (v: 'HIT' | 'MISS' | 'SKIP') => ({ 'Content-Type': 'application/json', 'X-Cache': v })
    if (cacheable) {
      const hit = await cacheGet(ctx.table, ctx.claims!.sub, url.search, ctx.claims!.inst).catch(() => null)
      if (hit !== null) return new NextResponse(hit, { headers: cacheHeader('HIT') })
    }

    const raw = url.searchParams.get('select') ?? '*'
    const cols =
      raw === '*'
        ? '*'
        : raw
            .split(',')
            .map((c) => ident(c.trim()))
            .filter((c) => c !== 'password_hash')
            .join(', ')
    const { clause, params: p } = buildWhere(ctx, url)
    // SCALING: `limit`/`offset`/`order` were parsed out of the filter loop but
    // never applied, so every list request was an unbounded sequential scan —
    // fine at demo size, an outage at real size. They are honoured now, and an
    // unpaginated request still gets a hard ceiling rather than the whole
    // table. MAX_ROWS is deliberately well above any legitimate single
    // workspace (a large notebook is a few hundred pages) so existing callers
    // that expect "everything" keep working.
    const { sql: tail, truncatedAt } = buildTail(ctx.table, url)
    const rows = await q(
      `select ${cols} from simblip_${ident(ctx.table)}${clause}${tail}`,
      p
    )
    const body = JSON.stringify(stripSecrets(rows))

    // A caller that asked for no limit and got exactly the ceiling is very
    // likely missing data — say so in a header rather than silently lying.
    const headers: Record<string, string> = cacheHeader(cacheable ? 'MISS' : 'SKIP')
    if (truncatedAt !== null && rows.length === truncatedAt) {
      headers['X-Truncated'] = String(truncatedAt)
      console.warn(
        `[pg] GET ${ctx.table} hit the ${truncatedAt}-row ceiling — caller should paginate`
      )
    }

    if (cacheable) await cacheSet(ctx.table, ctx.claims!.sub, url.search, body, ctx.claims!.inst).catch(() => {})
    return new NextResponse(body, { headers })
  } catch (err) {
    return errorResponse(err, ctx.table, 'GET')
  }
}

/** Reject inserts that would attach a join-table row to another tenant. */
async function assertJoinParentInTenant(
  table: string,
  row: Record<string, unknown>,
  claims: Claims
): Promise<void> {
  if (table === 'room_members') {
    const ok = await q<{ id: string }>(
      'select id from simblip_rooms where id = $1 and institution_id = $2',
      [row.room_id, claims.inst]
    )
    if (!ok[0]) throw new Error('Room is outside your institution')
  } else if (table === 'library_favorites') {
    const ok = await q<{ id: string }>(
      'select id from simblip_library_assets where id = $1 and institution_id = $2',
      [row.asset_id, claims.inst]
    )
    if (!ok[0]) throw new Error('Asset is outside your institution')
  }
}

export async function POST(req: Request, { params }: Params) {
  const ctx = await resolve(req, (await params).table, 'POST')
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = (await req.json()) as Record<string, unknown> | Record<string, unknown>[]
    const rows = Array.isArray(body) ? body : [body]
    const { table, spec, claims } = ctx
    for (const row of rows) {
      delete row.password_hash
      // Join tables never accept a client-supplied institution_id.
      if (JOIN_TABLE_SCOPE[table]) delete row.institution_id
      if (claims && !isOperator(claims)) {
        // Only stamp institution_id on tables that actually have the column.
        // Join tables are isolated via parent-room / parent-asset checks.
        if (TENANT_COLUMN.has(table)) row.institution_id = claims.inst ?? row.institution_id ?? PLATFORM_INSTITUTION
        if (spec.owner && claims.role !== 'board') row[spec.owner] = claims.sub
        if (JOIN_TABLE_SCOPE[table]) await assertJoinParentInTenant(table, row, claims)
      } else if (TENANT_COLUMN.has(table) && !row.institution_id) {
        row.institution_id = PLATFORM_INSTITUTION
      }
      // rawKeys preserves the original un-quoted key names for value lookup.
      // cols contains the ident-quoted names for safe SQL interpolation.
      const rawKeys = Object.keys(row)
      const cols = rawKeys.map(ident)
      const values = rawKeys.map((k) => encodeValue(table, k, row[k]))
      const placeholders = rawKeys.map((k, i) => `$${i + 1}${castFor(table, k)}`)
      // pk column names in spec are raw strings — compare against rawKeys.
      const updatable = rawKeys.filter((k) => !spec.pk.includes(k)).map(ident)
      const conflict =
        updatable.length > 0
          ? `do update set ${updatable.map((c) => `${c} = excluded.${c}`).join(', ')}`
          : 'do nothing'
      await q(
        `insert into simblip_${ident(table)} (${cols.join(', ')})
         values (${placeholders.join(', ')})
         on conflict (${spec.pk.map(ident).join(', ')}) ${conflict}`,
        values
      )
    }
    if (redisConfigured && CACHEABLE_TABLES.has(ctx.table) && ctx.claims) {
      await cacheInvalidate(ctx.table, ctx.claims.sub, ctx.claims.inst).catch(() => {})
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return errorResponse(err, ctx.table, 'POST')
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await resolve(req, (await params).table, 'PATCH')
  if (ctx instanceof NextResponse) return ctx
  try {
    const patch = (await req.json()) as Record<string, unknown>
    delete patch.password_hash
    const url = new URL(req.url)
    const { clause, params: wp } = buildWhere(ctx, url)
    if (!clause) return NextResponse.json({ error: 'Refusing unfiltered update' }, { status: 400 })
    const cols = Object.keys(patch).map(ident)
    if (cols.length === 0) return NextResponse.json({ ok: true })
    const sets = cols.map((c, i) => `${c} = $${wp.length + i + 1}${castFor(ctx.table, c)}`)
    await q(
      `update simblip_${ident(ctx.table)} set ${sets.join(', ')}${clause}`,
      [...wp, ...cols.map((c) => encodeValue(ctx.table, c, patch[c]))]
    )
    // Additive hook: feeds the board-live realtime bus so REST-path writes
    // (endSession, resolveSession, sendRemote's fallback) reach anyone
    // connected over the WS route too, without duplicating this file's
    // scoping/security logic. Never fails the request — a publish hiccup
    // just means peers fall back to their existing poll for this update.
    if (ctx.table === 'board_sessions') {
      const sessionId = url.searchParams.get('id')?.replace(/^eq\./, '')
      if (sessionId) {
        if ('status' in patch) {
          const evt: BoardLiveServerMsg = { type: 'status', status: patch.status as BoardSessionStatus }
          await publish(sessionId, evt).catch(() => {})
        }
        if ('remote' in patch) {
          const evt: BoardLiveServerMsg = { type: 'remote', cmd: patch.remote as RemoteCommand }
          await publish(sessionId, evt).catch(() => {})
        }
      }
    }
    if (redisConfigured && CACHEABLE_TABLES.has(ctx.table) && ctx.claims) {
      await cacheInvalidate(ctx.table, ctx.claims.sub, ctx.claims.inst).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, ctx.table, 'PATCH')
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const ctx = await resolve(req, (await params).table, 'DELETE')
  if (ctx instanceof NextResponse) return ctx
  try {
    const url = new URL(req.url)
    const { clause, params: p } = buildWhere(ctx, url)
    if (!clause) return NextResponse.json({ error: 'Refusing unfiltered delete' }, { status: 400 })
    await q(`delete from simblip_${ident(ctx.table)}${clause}`, p)
    if (redisConfigured && CACHEABLE_TABLES.has(ctx.table) && ctx.claims) {
      await cacheInvalidate(ctx.table, ctx.claims.sub, ctx.claims.inst).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, ctx.table, 'DELETE')
  }
}
