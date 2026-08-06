import { NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'

// Durable file storage (Vercel Blob), scoped to the caller's own manifest
// row — separate from app/api/files, which stays untouched serving only the
// ephemeral presentation-file use case. GET redirects to the Blob URL rather
// than proxying bytes through this function (same reasoning as the
// upload-url route); DELETE removes both the Blob object and the manifest
// row. List/metadata deliberately has no bespoke route here — a client
// reads/writes simblip_file_manifest rows via the existing generic
// /api/pg/simblip_file_manifest gateway (see app/api/pg/[table]/route.ts's
// TABLES map), which already gives GET/POST/DELETE with owner scoping for
// free.

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const rows = await q<{ blob_url: string }>(
    'select blob_url from simblip_file_manifest where id = $1 and owner_id = $2',
    [id, claims.sub]
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.redirect(rows[0].blob_url)
}

export async function DELETE(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const rows = await q<{ blob_url: string }>(
    'select blob_url from simblip_file_manifest where id = $1 and owner_id = $2',
    [id, claims.sub]
  )
  if (!rows[0]) return NextResponse.json({ ok: true }) // already gone — idempotent
  await del(rows[0].blob_url).catch(() => {})
  await q('delete from simblip_file_manifest where id = $1 and owner_id = $2', [id, claims.sub])
  return NextResponse.json({ ok: true })
}
