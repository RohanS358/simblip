import { NextResponse } from 'next/server'
import { pgConfigured, q, tx } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'
import { cacheInvalidate, redisConfigured } from '@/lib/server/redis'
import { QuotaExceededError, assertFits, lockOwner, usageOf } from '@/lib/server/quota'
import { MAX_ROW_BYTES, PROJECT_QUOTA_BYTES, jsonBytes } from '@/lib/storage/quota'

// Notebook sync endpoint — the ONLY write path for an account's small cloud
// data: the notebook tree (simblip_workspaces), page content (simblip_pages)
// and account-level data like the calendar (simblip_user_kv). /api/pg
// refuses writes to those tables so the quota and revision checks below
// can't be sidestepped.
//
// Every push is one transaction under a per-owner advisory lock:
//   1. deletions first (they free space),
//   2. each row's revision is checked against the rev the client's edit was
//      based on — a stale base is a CONFLICT, returned with the server copy
//      instead of overwriting it, so neither device's work is lost,
//   3. the net byte growth of the whole batch is checked against the 150 MB
//      project quota; over quota rejects the batch atomically (413),
//   4. rows are written with a server-computed size and rev + 1.
//
// GET is the incremental pull: rows changed since the server timestamp the
// client got from its previous pull (server clock, so device clock skew
// can't hide a change).

type Json = Record<string, unknown>

interface PagePush {
  id: string
  content: Json
  viewport?: unknown
  /** rev the local edit was based on; null = "never saw a server copy". */
  baseRev: number | null
  /** client has resolved a conflict and wants its copy written anyway */
  force?: boolean
}

interface KvPush {
  key: string
  value: unknown
  baseRev: number | null
  force?: boolean
}

interface PushBody {
  workspace?: { tree: Json; baseRev: number | null; force?: boolean }
  pages?: PagePush[]
  kv?: KvPush[]
  deletes?: string[]
}

// Ids only ever reach SQL as bound parameters, so any printable text is safe.
// (A strict [A-Za-z0-9_:.-] set rejected course pages like
// "course:enex-101/ohms-law" and, because it failed the whole batch, stuck
// every other queued change behind them.)
const ID_RE = /^[^\x00-\x1f\x7f]{1,200}$/
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const stale = (serverRev: number, baseRev: number | null) => serverRev > (baseRev ?? -1)

/** Key-order-independent JSON text — jsonb hands objects back with its own
 *  key order, so a plain stringify would call identical content different. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

/** A database that hasn't had migration 003 applied: say so plainly (503) so
 *  clients back off, instead of a stream of opaque 500s. */
function schemaMissing(err: unknown): NextResponse | null {
  const code = (err as { code?: string })?.code
  if (code !== '42703' && code !== '42P01') return null
  return NextResponse.json(
    { error: 'sync_unavailable', detail: 'Run db/migrations/003-sync-storage-quota.sql on this database.' },
    { status: 503 }
  )
}

export async function GET(req: Request) {
  try {
    return await pull(req)
  } catch (err) {
    const missing = schemaMissing(err)
    if (missing) return missing
    throw err
  }
}

async function pull(req: Request) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const owner = claims.sub
  const url = new URL(req.url)
  const sinceRaw = url.searchParams.get('since')
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : '1970-01-01T00:00:00Z'
  const afterId = url.searchParams.get('after') ?? ''

  // Sequential, not Promise.all: the pool is deliberately tiny (lib/server/pg.ts,
  // max 3 per instance) and five parallel queries per pull took every
  // connection — auth and everything else queued behind a single device's pull.
  const [now] = await q<{ now: string }>('select now()::text as now')
  const ws = await q<{ notebooks: unknown; rev: string; updated_at: string }>(
    'select notebooks, rev, updated_at from simblip_workspaces where id = $1 and updated_at >= $2',
    [owner, since]
  )
  // Keyset pagination on (updated_at, id): one push stamps up to 200 rows
  // with the SAME updated_at, so a timestamp-only cursor could skip or
  // endlessly repeat a group. `ts` is the full-precision text form — a JS
  // Date would drop the microseconds and break the equality half.
  const pages = await q<{ id: string; content: unknown; viewport: unknown; rev: string; ts: string }>(
    `select id, content, viewport, rev, updated_at::text as ts from simblip_pages
      where workspace_id = $1 and (updated_at > $2 or (updated_at = $2 and id > $3))
      order by updated_at, id limit 500`,
    [owner, since, afterId]
  )
  const kv = await q<{ key: string; value: unknown; rev: string }>(
    'select key, value, rev from simblip_user_kv where owner_id = $1 and updated_at >= $2',
    [owner, since]
  )
  // Every page id the server holds — cheap (no content), and lets a client
  // notice rows that vanished (deleted elsewhere) without a tombstone table.
  const ids = await q<{ id: string; rev: string }>('select id, rev from simblip_pages where workspace_id = $1', [owner])
  // Workspace/kv bounds are inclusive (`>=`): a re-sent row is harmless, the
  // client skips any rev it already has. A full page of 500 means more pages
  // remain; the client continues from the cursor instead of `now`.
  const more = pages.length === 500
  const last = pages[pages.length - 1]
  return NextResponse.json({
    now: more ? last.ts : now.now,
    after: more ? last.id : '',
    more,
    workspace: ws[0] ? { tree: ws[0].notebooks, rev: Number(ws[0].rev) } : null,
    pages: pages.map((p) => ({ id: p.id, content: p.content, viewport: p.viewport, rev: Number(p.rev) })),
    kv: kv.map((k) => ({ key: k.key, value: k.value, rev: Number(k.rev) })),
    serverPages: Object.fromEntries(ids.map((r) => [r.id, Number(r.rev)])),
  })
}

export async function POST(req: Request) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Room boards are shared kiosk identities; their pages are temporary
  // presentation copies and never sync as a notebook.
  if (claims.role === 'board') return NextResponse.json({ error: 'Boards do not sync notebooks' }, { status: 403 })
  const owner = claims.sub

  let body: PushBody
  try {
    body = (await req.json()) as PushBody
  } catch {
    return badRequest('Body must be JSON')
  }
  const pages = Array.isArray(body.pages) ? body.pages : []
  const kv = Array.isArray(body.kv) ? body.kv : []
  // A delete id that can't be valid can't match a row either: drop it rather
  // than refuse the batch.
  const deletes = (Array.isArray(body.deletes) ? body.deletes : []).filter(
    (d): d is string => typeof d === 'string' && ID_RE.test(d)
  )
  if (pages.length > 200 || kv.length > 20 || deletes.length > 1000) return badRequest('Batch too large')
  for (const p of pages) {
    if (!ID_RE.test(String(p?.id)) || !isObj(p.content)) return badRequest('Bad page row')
  }
  for (const k of kv) if (!ID_RE.test(String(k?.key))) return badRequest('Bad kv key')
  if (body.workspace && !isObj(body.workspace.tree)) return badRequest('Bad workspace tree')

  // Sizes are measured HERE from what was received — never client-reported.
  const sized = pages.map((p) => ({ ...p, bytes: jsonBytes(p.content) + jsonBytes(p.viewport ?? null) }))
  const kvSized = kv.map((k) => ({ ...k, bytes: jsonBytes(k.value) }))
  const treeBytes = body.workspace ? jsonBytes(body.workspace.tree) : 0
  const tooBig = sized.find((p) => p.bytes > MAX_ROW_BYTES)
  if (tooBig || treeBytes > MAX_ROW_BYTES || kvSized.some((k) => k.bytes > MAX_ROW_BYTES)) {
    return NextResponse.json(
      { error: 'row_too_large', id: tooBig?.id ?? null, limit: MAX_ROW_BYTES },
      { status: 413 }
    )
  }

  try {
    const result = await tx(async (query) => {
      await lockOwner(query, owner)

      // Institution for new rows: the token's (trusted — verified signature),
      // falling back to the profile row.
      let inst = claims.inst
      if (!inst) {
        const [p] = await query<{ institution_id: string }>(
          'select institution_id from simblip_profiles where id = $1',
          [owner]
        )
        inst = p?.institution_id ?? null
      }
      if (!inst) throw new Error('No institution for this account')

      if (deletes.length > 0) {
        await query('delete from simblip_pages where workspace_id = $1 and id = any($2::text[])', [owner, deletes])
      }

      // ── Revision checks (and the bytes each accepted row replaces) ──
      let delta = 0
      const conflicts: { id: string; content: unknown; viewport: unknown; rev: number }[] = []
      const accepted: (typeof sized)[number][] = []
      const oldRev = new Map<string, number>()
      const adopted: Record<string, number> = {}
      if (sized.length > 0) {
        const existing = await query<{
          id: string
          workspace_id: string
          rev: string
          size_bytes: string
          content: unknown
          viewport: unknown
        }>(
          'select id, workspace_id, rev, size_bytes, content, viewport from simblip_pages where id = any($1::text[]) for update',
          [sized.map((p) => p.id)]
        )
        const byId = new Map(existing.map((r) => [r.id, r]))
        for (const p of sized) {
          const row = byId.get(p.id)
          // Another account's page id: never overwrite or adopt it. (The old
          // generic upsert did exactly that — a known page id was enough to
          // take someone else's page.)
          if (row && row.workspace_id !== owner) continue
          if (row && !p.force && stale(Number(row.rev), p.baseRev)) {
            // Identical content isn't a real conflict (e.g. first sync after
            // an upgrade, when the client has no revs yet): just adopt it.
            if (canonical(row.content) === canonical(p.content)) {
              adopted[p.id] = Number(row.rev)
              continue
            }
            conflicts.push({ id: p.id, content: row.content, viewport: row.viewport, rev: Number(row.rev) })
            continue
          }
          delta += p.bytes - Number(row?.size_bytes ?? 0)
          oldRev.set(p.id, Number(row?.rev ?? 0))
          accepted.push(p)
        }
      }

      let wsConflict: { tree: unknown; rev: number } | null = null
      let wsWrite = false
      let wsOldRev = 0
      const [wsRow] = await query<{ rev: string; size_bytes: string; notebooks: unknown }>(
        'select rev, size_bytes, notebooks from simblip_workspaces where id = $1 for update',
        [owner]
      )
      if (body.workspace) {
        if (wsRow && !body.workspace.force && stale(Number(wsRow.rev), body.workspace.baseRev)) {
          wsConflict = { tree: wsRow.notebooks, rev: Number(wsRow.rev) }
        } else {
          wsWrite = true
          wsOldRev = Number(wsRow?.rev ?? 0)
          delta += treeBytes - Number(wsRow?.size_bytes ?? 0)
        }
      }

      const kvConflicts: { key: string; value: unknown; rev: number }[] = []
      const kvAccepted: (typeof kvSized)[number][] = []
      const kvOldRev = new Map<string, number>()
      if (kvSized.length > 0) {
        const rows = await query<{ key: string; rev: string; size_bytes: string; value: unknown }>(
          'select key, rev, size_bytes, value from simblip_user_kv where owner_id = $1 and key = any($2::text[]) for update',
          [owner, kvSized.map((k) => k.key)]
        )
        const byKey = new Map(rows.map((r) => [r.key, r]))
        for (const k of kvSized) {
          const row = byKey.get(k.key)
          if (row && !k.force && stale(Number(row.rev), k.baseRev)) {
            kvConflicts.push({ key: k.key, value: row.value, rev: Number(row.rev) })
            continue
          }
          delta += k.bytes - Number(row?.size_bytes ?? 0)
          kvOldRev.set(k.key, Number(row?.rev ?? 0))
          kvAccepted.push(k)
        }
      }

      // ── Quota: the batch's NET growth, checked once, atomically ──
      await assertFits(query, owner, delta)

      // ── Writes ──
      // Pages reference the workspace row, so it must exist first.
      if (!wsRow) {
        await query(
          `insert into simblip_workspaces (id, institution_id, notebooks, rev, size_bytes, updated_at)
           values ($1, $2, $3::jsonb, $4, $5, now())`,
          [owner, inst, JSON.stringify(wsWrite ? body.workspace!.tree : {}), wsWrite ? 1 : 0, wsWrite ? treeBytes : 2]
        )
      } else if (wsWrite) {
        await query(
          `update simblip_workspaces set notebooks = $2::jsonb, rev = $3, size_bytes = $4, updated_at = now()
            where id = $1`,
          [owner, JSON.stringify(body.workspace!.tree), wsOldRev + 1, treeBytes]
        )
      }

      const revs: Record<string, number> = { ...adopted }
      for (const p of accepted) {
        const rev = (oldRev.get(p.id) ?? 0) + 1
        const [row] = await query<{ rev: string }>(
          `insert into simblip_pages (id, workspace_id, institution_id, content, viewport, rev, size_bytes, updated_at)
           values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, now())
           on conflict (id) do update set
             content = excluded.content, viewport = excluded.viewport, rev = excluded.rev,
             size_bytes = excluded.size_bytes, updated_at = now()
           where simblip_pages.workspace_id = excluded.workspace_id
           returning rev`,
          [p.id, owner, inst, JSON.stringify(p.content), p.viewport == null ? null : JSON.stringify(p.viewport), rev, p.bytes]
        )
        if (row) revs[p.id] = Number(row.rev)
      }

      const kvRevs: Record<string, number> = {}
      for (const k of kvAccepted) {
        const rev = (kvOldRev.get(k.key) ?? 0) + 1
        await query(
          `insert into simblip_user_kv (owner_id, institution_id, key, value, rev, size_bytes, updated_at)
           values ($1, $2, $3, $4::jsonb, $5, $6, now())
           on conflict (owner_id, key) do update set
             value = excluded.value, rev = excluded.rev, size_bytes = excluded.size_bytes, updated_at = now()`,
          [owner, inst, k.key, JSON.stringify(k.value ?? null), rev, k.bytes]
        )
        kvRevs[k.key] = rev
      }

      const usage = await usageOf(query, owner)
      return {
        workspace: wsConflict ? { conflict: wsConflict } : wsWrite ? { rev: wsOldRev + 1 } : null,
        revs,
        conflicts,
        kv: kvRevs,
        kvConflicts,
        usage: { used: usage.total, limit: PROJECT_QUOTA_BYTES },
      }
    })

    if (redisConfigured && body.workspace) {
      await cacheInvalidate('workspaces', owner, claims.inst).catch(() => {})
    }
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof QuotaExceededError) return NextResponse.json(err.body(), { status: 413 })
    const missing = schemaMissing(err)
    if (missing) return missing
    console.error('[sync] push failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}

/** DELETE /api/sync?types=pages,files,account — wipe the chosen kinds of cloud
 *  data for this account. The notebook tree is deliberately not offered: other
 *  devices merge it three-way, and an emptied tree would read as "everything
 *  was deleted". Local copies are never touched; that is the client's job. */
export async function DELETE(req: Request) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const owner = claims.sub
  const types = new Set((new URL(req.url).searchParams.get('types') ?? '').split(','))
  if (![...types].some((t) => ['pages', 'files', 'account'].includes(t))) return badRequest('No types selected')
  try {
    await tx(async (query) => {
      await lockOwner(query, owner)
      if (types.has('pages')) await query('delete from simblip_pages where workspace_id = $1', [owner])
      if (types.has('files')) await query('delete from simblip_file_manifest where owner_id = $1', [owner]) // cascades to blobs
      if (types.has('account')) await query('delete from simblip_user_kv where owner_id = $1', [owner])
    })
    if (redisConfigured && types.has('files')) await cacheInvalidate('file_manifest', owner, claims.inst).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (err) {
    const missing = schemaMissing(err)
    if (missing) return missing
    console.error('[sync] clear failed:', err)
    return NextResponse.json({ error: 'Could not clear cloud data' }, { status: 500 })
  }
}
