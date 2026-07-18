import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'

// Presentation + notebook file store (replaces the Supabase `simblip-session`
// bucket). Presentation files are ephemeral by design: the teacher's device
// deletes them when the presentation resolves, and every upload
// opportunistically sweeps rows older than 3 hours. NOTEBOOK documents
// (paths under `notebook/`) are the PDFs/PPTs users read in doc pages — they
// keep for 7 days, and every read renews the clock, so a document only
// disappears after 7 days of not being opened anywhere.

type Params = { params: Promise<{ path: string[] }> }

const key = async (params: Params['params']) => (await params).path.join('/')

export async function GET(_req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const path = await key(params)
  const rows = await q<{ mime: string; data: Buffer }>(
    'select mime, data from simblip_session_files where path = $1',
    [path]
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Reading a notebook document keeps it alive — the 7-day clock restarts.
  if (path.startsWith('notebook/'))
    void q('update simblip_session_files set created_at = now() where path = $1', [path]).catch(() => {})
  return new NextResponse(new Uint8Array(rows[0].data), {
    headers: {
      'Content-Type': rows[0].mime || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export async function POST(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  if (!bearerClaims(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const data = Buffer.from(await req.arrayBuffer())
  await q(
    `insert into simblip_session_files (path, mime, data) values ($1, $2, $3)
     on conflict (path) do update set mime = excluded.mime, data = excluded.data, created_at = now()`,
    [await key(params), req.headers.get('content-type') ?? 'application/octet-stream', data]
  )
  void q(
    `delete from simblip_session_files
     where (path not like 'notebook/%' and created_at < now() - interval '3 hours')
        or (path like 'notebook/%' and created_at < now() - interval '7 days')`
  ).catch(() => {})
  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  if (!bearerClaims(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await q('delete from simblip_session_files where path = $1', [await key(params)])
  return NextResponse.json({ ok: true })
}
