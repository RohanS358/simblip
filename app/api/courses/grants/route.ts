import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'

// Who may open which course — the ADMIN tier of docs/course-mode.md.
//
//   GET    /api/courses/grants   → this institution's grants + the catalogue
//   POST   /api/courses/grants   → grant a course to a room or a profile
//   DELETE /api/courses/grants   → revoke one
//
// An admin never edits lesson content; they decide reach. Revoking removes the
// grant, never the student's progress — that is keyed by page id in
// lib/store/course.ts and survives being re-granted later.

/** Admins act within their own institution; a super_admin crosses tenants. */
async function caller(req: Request) {
  const claims = bearerClaims(req)
  if (!claims) return null
  const rows = await q<{ id: string; role: string; active: boolean; institution_id: string }>(
    'select id, role, active, institution_id from simblip_profiles where id = $1',
    [claims.sub]
  )
  const c = rows[0]
  if (!c?.active || (c.role !== 'admin' && c.role !== 'super_admin')) return null
  return c
}

export async function GET(req: Request) {
  if (!pgConfigured) return NextResponse.json({ grants: [], catalogue: [] })
  const me = await caller(req)
  if (!me) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const grants = await q(
    `select g.id, g.course_id, g.target_room_id, g.target_profile_id, g.granted_at,
            c.code, c.title, c.semester,
            r.name  as room_name,
            p.full_name as profile_name
       from simblip_course_grants g
       join simblip_courses c on c.id = g.course_id
       left join simblip_rooms r    on r.id = g.target_room_id
       left join simblip_profiles p on p.id = g.target_profile_id
      where g.institution_id = $1
      order by c.semester nulls last, c.code`,
    [me.institution_id]
  )

  // Everything grantable, so the console can offer it without a second call.
  const catalogue = await q(
    `select id, code, title, subject, semester, version
       from simblip_courses where published
      order by semester nulls last, code`
  )

  return NextResponse.json({ grants, catalogue })
}

export async function POST(req: Request) {
  if (!pgConfigured) return NextResponse.json({ error: 'Requires DATABASE_URL' }, { status: 500 })
  const me = await caller(req)
  if (!me) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { courseId, roomId, profileId } = (await req.json()) as {
    courseId?: string
    roomId?: string
    profileId?: string
  }
  if (!courseId) return NextResponse.json({ error: 'courseId is required' }, { status: 400 })
  if (!roomId === !profileId) {
    return NextResponse.json(
      { error: 'Grant to exactly one of roomId (a class) or profileId (one person)' },
      { status: 400 }
    )
  }

  // The target must belong to the admin's own institution — otherwise an admin
  // could grant into a tenant they do not administer by supplying a foreign id.
  if (roomId) {
    const ok = await q('select 1 from simblip_rooms where id = $1 and institution_id = $2', [
      roomId,
      me.institution_id,
    ])
    if (!ok.length) return NextResponse.json({ error: 'Unknown room' }, { status: 404 })
  } else {
    const ok = await q('select 1 from simblip_profiles where id = $1 and institution_id = $2', [
      profileId,
      me.institution_id,
    ])
    if (!ok.length) return NextResponse.json({ error: 'Unknown profile' }, { status: 404 })
  }

  // A grant is a fact about (course, target): granting twice is not two grants.
  await q(
    `insert into simblip_course_grants
       (course_id, institution_id, target_room_id, target_profile_id, granted_by)
     values ($1,$2,$3,$4,$5)
     on conflict do nothing`,
    [courseId, me.institution_id, roomId ?? null, profileId ?? null, me.id]
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!pgConfigured) return NextResponse.json({ error: 'Requires DATABASE_URL' }, { status: 500 })
  const me = await caller(req)
  if (!me) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  await q('delete from simblip_course_grants where id = $1 and institution_id = $2', [
    id,
    me.institution_id,
  ])
  return NextResponse.json({ ok: true })
}
