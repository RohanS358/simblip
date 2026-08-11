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
  devices: { pk: ['id'], owner: 'owner_id', anon: ['GET', 'POST', 'PATCH', 'DELETE'] },
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

function resolve(req: Request, tableParam: string, method: string): Ctx | NextResponse {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const table = tableParam.replace(/^simblip_/, '')
  const spec = TABLES[table]
  if (!spec) return NextResponse.json({ error: 'Unknown table' }, { status: 404 })
  const claims = bearerClaims(req)
  if (!claims && !spec.anon?.includes(method)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const explicitCols = new Set<string>()

  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'select' || k === 'order' || k === 'limit' || k === 'offset') continue
    const col = ident(k)
    if (col === 'password_hash') throw new Error('Forbidden column')
    explicitCols.add(col)
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
  if (claims && !isOperator(claims)) {
    if (table === 'institutions') {
      if (!explicitCols.has('id') && claims.inst) {
        params.push(claims.inst)
        parts.push(`id = $${params.length}`)
      }
    } else if (TENANT_COLUMN.has(table)) {
      if (!explicitCols.has('institution_id') && claims.inst) {
        params.push(claims.inst)
        parts.push(`institution_id = $${params.length}`)
      }
    } else if (JOIN_TABLE_SCOPE[table]) {
      if (claims.inst) {
        params.push(claims.inst)
        parts.push(JOIN_TABLE_SCOPE[table](params.length))
      }
    }
    if (spec.owner && claims.role !== 'board' && !explicitCols.has(spec.owner)) {
      params.push(claims.sub)
      parts.push(`${spec.owner} = $${params.length}`)
    }
  }
  return { clause: parts.length ? ` where ${parts.join(' and ')}` : '', params }
}

const stripSecrets = (rows: Record<string, unknown>[]) =>
  rows.map(({ password_hash: _ph, ...rest }) => rest)

type Params = { params: Promise<{ table: string }> }

export async function GET(req: Request, { params }: Params) {
  const ctx = resolve(req, (await params).table, 'GET')
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
      const hit = await cacheGet(ctx.table, ctx.claims!.sub, url.search).catch(() => null)
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
    const rows = await q(`select ${cols} from simblip_${ident(ctx.table)}${clause}`, p)
    const body = JSON.stringify(stripSecrets(rows))

    if (cacheable) await cacheSet(ctx.table, ctx.claims!.sub, url.search, body).catch(() => {})
    return new NextResponse(body, { headers: cacheHeader(cacheable ? 'MISS' : 'SKIP') })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 })
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
  const ctx = resolve(req, (await params).table, 'POST')
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
      await cacheInvalidate(ctx.table, ctx.claims.sub).catch(() => {})
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 })
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = resolve(req, (await params).table, 'PATCH')
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
      await cacheInvalidate(ctx.table, ctx.claims.sub).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 })
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const ctx = resolve(req, (await params).table, 'DELETE')
  if (ctx instanceof NextResponse) return ctx
  try {
    const url = new URL(req.url)
    const { clause, params: p } = buildWhere(ctx, url)
    if (!clause) return NextResponse.json({ error: 'Refusing unfiltered delete' }, { status: 400 })
    await q(`delete from simblip_${ident(ctx.table)}${clause}`, p)
    if (redisConfigured && CACHEABLE_TABLES.has(ctx.table) && ctx.claims) {
      await cacheInvalidate(ctx.table, ctx.claims.sub).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 })
  }
}
