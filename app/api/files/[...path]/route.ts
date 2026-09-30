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

// SECURITY: this route used to hand back whatever Content-Type the uploader
// declared, inline, from SIMBLIP's own origin, and let any signed-in user write
// or delete ANY path. An uploaded text/html or image/svg+xml file opened via
// its link ran scripts on our origin (sessions live in localStorage), and a
// student could overwrite another class's presentation. Now: active types are
// only ever downloads, every response is sandboxed, and writes are limited to
// files under a session the caller is presenting.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript|text\/css)/i
const MAX_FILE_BYTES = 50 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Caller may write `<sessionId>/<key>` for a session they present.
 *  lib/data/boards.ts uploads a presentation's files BEFORE inserting the
 *  session row (the row stores the resulting URLs), so a session id that does
 *  not exist yet is allowed: it is a client-minted UUID nobody else can guess.
 *  An id that does exist must be the caller's own — that is what stops one
 *  teacher overwriting another's live presentation.
 *  ponytail: a fresh UUID is unowned, so a signed-in user could park files
 *  under invented ids until the 3 h sweep; add a per-user row cap if abused. */
async function ownsSessionPath(path: string, claims: { sub: string; inst: string | null }): Promise<boolean> {
  const [sessionId, key, ...rest] = path.split('/')
  if (!sessionId || !key || rest.length || !UUID.test(sessionId)) return false
  const rows = await q<{ teacher_id: string; institution_id: string }>(
    'select teacher_id, institution_id from simblip_board_sessions where id = $1',
    [sessionId]
  )
  if (rows.length === 0) return true
  return rows[0].teacher_id === claims.sub && rows[0].institution_id === claims.inst
}

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
  const mime = rows[0].mime || 'application/octet-stream'
  const active = ACTIVE_TYPES.test(mime)
  return new NextResponse(new Uint8Array(rows[0].data), {
    headers: {
      'Content-Type': active ? 'application/octet-stream' : mime,
      ...(active ? { 'Content-Disposition': 'attachment' } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export async function POST(req: Request, { params }: Params) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const path = await key(params)
  if (!(await ownsSessionPath(path, claims))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_FILE_BYTES)
    return NextResponse.json({ error: 'File is too large' }, { status: 413 })
  const data = Buffer.from(await req.arrayBuffer())
  if (data.byteLength > MAX_FILE_BYTES) return NextResponse.json({ error: 'File is too large' }, { status: 413 })
  await q(
    `insert into simblip_session_files (path, mime, data) values ($1, $2, $3)
     on conflict (path) do update set mime = excluded.mime, data = excluded.data, created_at = now()`,
    [path, req.headers.get('content-type') ?? 'application/octet-stream', data]
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
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const path = await key(params)
  if (!(await ownsSessionPath(path, claims))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await q('delete from simblip_session_files where path = $1', [path])
  return NextResponse.json({ ok: true })
}
