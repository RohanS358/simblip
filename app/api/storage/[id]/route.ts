import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { pgConfigured, q, tx } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'
import { cacheInvalidate, redisConfigured } from '@/lib/server/redis'
import { QuotaExceededError, assertFits, lockOwner } from '@/lib/server/quota'
import { PROJECT_QUOTA_BYTES } from '@/lib/storage/quota'

// Durable file storage — bytes live in Postgres (simblip_file_blobs), scoped
// to the caller's own manifest row, counted against the account's 150 MB
// project quota (lib/server/quota.ts). A file only gets here when the user
// opted it into cloud sync; everything else stays in the device's OPFS.
// PUT/GET/DELETE proxy bytes through this function directly (Vercel
// Functions accept up to 100 MB request bodies).

type Params = { params: Promise<{ id: string }> }

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/

// Types a browser would EXECUTE if served inline from our origin. They are
// stored as-is but only ever handed back as a download.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript)/i

export async function GET(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const rows = await q<{ data: Buffer; mime: string; name: string; sha256: string }>(
    `select b.data, m.mime, m.name, m.sha256
       from simblip_file_blobs b join simblip_file_manifest m on m.id = b.id
      where b.id = $1 and m.owner_id = $2`,
    [id, claims.sub]
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { mime, name, sha256 } = rows[0]
  const active = ACTIVE_TYPES.test(mime)
  return new NextResponse(new Uint8Array(rows[0].data), {
    headers: {
      'Content-Type': active ? 'application/octet-stream' : mime || 'application/octet-stream',
      'Content-Disposition': `${active ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name)}"`,
      // Never sniff a stored upload into something executable, and if it is
      // ever opened directly, give it no scripts and no origin.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
      ...(sha256 ? { ETag: `"${sha256}"` } : {}),
    },
  })
}

/** Upload/overwrite a file's bytes. Metadata (name/mime/sha256) travels as
 *  query params since the body is the raw file. Size and hash are measured
 *  here from the bytes actually received; the client's sha256 is only used to
 *  detect a corrupted or truncated upload. */
export async function PUT(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!claims.inst) return NextResponse.json({ error: 'No institution' }, { status: 400 })
  const { id } = await params
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'Bad file id' }, { status: 400 })
  const url = new URL(req.url)
  const name = (url.searchParams.get('name') ?? id).slice(0, 255)
  const mime = (url.searchParams.get('mime') ?? 'application/octet-stream').slice(0, 127)
  const claimedSha = url.searchParams.get('sha256') ?? ''

  // Refuse obviously-too-large bodies before buffering them.
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > PROJECT_QUOTA_BYTES) {
    return NextResponse.json(new QuotaExceededError(0, declared).body(), { status: 413 })
  }
  const buf = Buffer.from(await req.arrayBuffer())
  const sha256 = createHash('sha256').update(buf).digest('hex')
  if (claimedSha && claimedSha !== sha256) {
    return NextResponse.json({ error: 'integrity_mismatch', expected: claimedSha, got: sha256 }, { status: 422 })
  }

  try {
    const out = await tx(async (query) => {
      await lockOwner(query, claims.sub)
      const [existing] = await query<{ owner_id: string; sha256: string; size_bytes: string | null }>(
        `select m.owner_id, m.sha256, b.size_bytes
           from simblip_file_manifest m left join simblip_file_blobs b on b.id = m.id
          where m.id = $1 for update of m`,
        [id]
      )
      // Someone else's file id: never overwrite their bytes. (This route used
      // to skip only the manifest update and still replace the blob.)
      if (existing && existing.owner_id !== claims.sub) return { forbidden: true as const }
      // Same bytes already stored: a retried or duplicate upload costs nothing.
      if (existing && existing.sha256 === sha256 && existing.size_bytes !== null) {
        return { ok: true, size: buf.byteLength, deduped: true }
      }
      await assertFits(query, claims.sub, buf.byteLength - Number(existing?.size_bytes ?? 0))
      await query(
        `insert into simblip_file_manifest (id, owner_id, institution_id, name, mime, size, sha256, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (id) do update set
           name = excluded.name, mime = excluded.mime, size = excluded.size,
           sha256 = excluded.sha256, updated_at = now()
         where simblip_file_manifest.owner_id = $2`,
        [id, claims.sub, claims.inst, name, mime, buf.byteLength, sha256]
      )
      await query(
        `insert into simblip_file_blobs (id, data, size_bytes) values ($1, $2, $3)
         on conflict (id) do update set data = excluded.data, size_bytes = excluded.size_bytes`,
        [id, buf, buf.byteLength]
      )
      return { ok: true, size: buf.byteLength, deduped: false }
    })
    if ('forbidden' in out) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (redisConfigured) await cacheInvalidate('file_manifest', claims.sub, claims.inst).catch(() => {})
    return NextResponse.json({ ...out, sha256 })
  } catch (err) {
    if (err instanceof QuotaExceededError) return NextResponse.json(err.body(), { status: 413 })
    throw err
  }
}

/** Remove the CLOUD copy (manifest row + bytes). The device's local copy is
 *  not affected — that lives in OPFS and is the client's business. */
export async function DELETE(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await q('delete from simblip_file_manifest where id = $1 and owner_id = $2', [id, claims.sub])
  if (redisConfigured) await cacheInvalidate('file_manifest', claims.sub, claims.inst).catch(() => {})
  return NextResponse.json({ ok: true }) // idempotent — cascades to simblip_file_blobs
}
