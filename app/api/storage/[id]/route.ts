import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'

// Durable file storage — bytes live in Postgres (simblip_file_blobs), scoped
// to the caller's own manifest row. Moved off Vercel Blob (see schema.sql's
// comment on simblip_file_blobs for why) — separate from app/api/files,
// which stays untouched serving only the ephemeral presentation-file use
// case. PUT/GET/DELETE all proxy bytes through this function directly
// (Vercel Functions accept up to 100MB request bodies, comfortably above
// what a single user file needs) rather than a client-upload token, since
// there's no third-party service left to hand a token out to.

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const rows = await q<{ data: Buffer; mime: string; name: string }>(
    `select b.data, m.mime, m.name
       from simblip_file_blobs b join simblip_file_manifest m on m.id = b.id
      where b.id = $1 and m.owner_id = $2`,
    [id, claims.sub]
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new NextResponse(new Uint8Array(rows[0].data), {
    headers: {
      'Content-Type': rows[0].mime || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].name)}"`,
    },
  })
}

/** Upload/overwrite a file's bytes. Metadata (name/mime/size/sha256) travels
 *  as query params since the body is the raw file — mirrors the manifest
 *  row lib/storage/manager.ts already builds client-side. Upserts both
 *  tables in one request: the two-step "get a token, then POST the manifest
 *  row" dance this route used to require (Blob's client-upload flow) is
 *  gone now that bytes go straight to our own database. */
export async function PUT(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!claims.inst) return NextResponse.json({ error: 'No institution' }, { status: 400 })
  const { id } = await params
  const url = new URL(req.url)
  const name = url.searchParams.get('name') ?? id
  const mime = url.searchParams.get('mime') ?? 'application/octet-stream'
  const sha256 = url.searchParams.get('sha256') ?? ''
  const buf = Buffer.from(await req.arrayBuffer())

  await q(
    `insert into simblip_file_manifest (id, owner_id, institution_id, name, mime, size, sha256, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (id) do update set
       name = excluded.name, mime = excluded.mime, size = excluded.size,
       sha256 = excluded.sha256, updated_at = now()
     where simblip_file_manifest.owner_id = $2`,
    [id, claims.sub, claims.inst, name, mime, buf.byteLength, sha256]
  )
  await q(
    `insert into simblip_file_blobs (id, data) values ($1, $2)
     on conflict (id) do update set data = excluded.data`,
    [id, buf]
  )
  return NextResponse.json({ ok: true, size: buf.byteLength })
}

export async function DELETE(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await q('delete from simblip_file_manifest where id = $1 and owner_id = $2', [id, claims.sub])
  return NextResponse.json({ ok: true }) // idempotent — cascades to simblip_file_blobs
}
