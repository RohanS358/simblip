import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'
import { coursesFromFiles } from '@/lib/server/course-files'

// Which institutions a course may be used by — the PLATFORM tier, above the
// admin's grants (docs/course-mode.md).
//
//   GET    /api/courses/allowances  → repo catalogue + published state +
//                                     institutions + current allowances
//   POST   /api/courses/allowances  → allow a course on an institution
//                                     ({ courseId, institutionId, allMembers? })
//   DELETE /api/courses/allowances?id=…  → withdraw one
//
// WHY THIS TIER EXISTS. Publishing a course made it grantable by EVERY
// institution's admin, which is not what publishing a course should mean: a
// course is licensed to institutions, and only then handed out inside one. The
// operator console is where that decision belongs, so it is one call away from
// the same place institutions and accounts are provisioned.
//
// `allMembers` is the shortcut for a course everyone at an institution should
// simply have — a first-year core subject — instead of asking its admin to
// grant it to every room in turn. Left false, the allowance is a licence and
// the institution's own admin still decides who gets it.

/** The platform operator, and nobody else. An institution admin manages reach
 *  INSIDE their institution (/api/courses/grants); deciding which
 *  institutions may use a course at all is not theirs to make. */
async function operator(req: Request) {
  const claims = bearerClaims(req)
  if (!claims) return null
  const rows = await q<{ id: string; role: string; active: boolean }>(
    'select id, role, active from simblip_profiles where id = $1',
    [claims.sub]
  )
  const me = rows[0]
  return me?.active && me.role === 'super_admin' ? me : null
}

/** Everything the console needs to render in one call: what the checkout has,
 *  what the database has, and who is allowed what. */
export async function GET(req: Request) {
  // No database: the repository is already serving every course to this
  // device (lib/server/course-files.ts), so there is nothing to license and
  // nothing to store. Say that rather than showing an empty table.
  if (!pgConfigured) {
    return NextResponse.json({
      mode: 'local',
      repo: coursesFromFiles().map((c) => ({
        id: c.id, code: c.code, title: c.title, subject: c.subject,
        semester: c.semester, lessons: c.lessons.length,
      })),
      published: [],
      institutions: [],
      allowances: [],
    })
  }

  const me = await operator(req)
  if (!me) return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 })

  // A deployment whose schema predates this tier has no allowances table.
  // That is "nothing allowed yet", not a server fault — the console shows the
  // migration hint instead of an error page.
  let allowances: unknown[] = []
  let migrated = true
  try {
    allowances = await q(
      `select a.id, a.course_id, a.institution_id, a.all_members, a.allowed_at,
              i.name as institution_name
         from simblip_course_allowances a
         join simblip_institutions i on i.id = a.institution_id
        order by i.name, a.course_id`
    )
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') migrated = false
    else throw e
  }

  const published = await q(
    `select c.id, c.code, c.title, c.subject, c.semester, c.version, c.published,
            c.updated_at, count(l.id)::int as lessons
       from simblip_courses c
       left join simblip_course_lessons l on l.course_id = c.id
      group by c.id
      order by c.semester nulls last, c.code`
  )

  const institutions = await q(
    'select id, name from simblip_institutions order by name'
  )

  return NextResponse.json({
    mode: 'cloud',
    migrated,
    repo: coursesFromFiles().map((c) => ({
      id: c.id, code: c.code, title: c.title, subject: c.subject,
      semester: c.semester, lessons: c.lessons.length,
    })),
    published,
    institutions,
    allowances,
  })
}

export async function POST(req: Request) {
  if (!pgConfigured) {
    return NextResponse.json({ error: 'Allowances need DATABASE_URL' }, { status: 500 })
  }
  const me = await operator(req)
  if (!me) return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 })

  let body: { courseId?: string; institutionId?: string; allMembers?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  if (!body.courseId || !body.institutionId) {
    return NextResponse.json({ error: 'courseId and institutionId are required' }, { status: 400 })
  }

  // A course must exist in the database before it can be licensed: allowing
  // an unpublished id would silently give an institution nothing.
  const exists = await q('select 1 from simblip_courses where id = $1', [body.courseId])
  if (exists.length === 0) {
    return NextResponse.json(
      { error: 'That course is not published yet — publish it first' },
      { status: 400 }
    )
  }

  try {
    await q(
      `insert into simblip_course_allowances (course_id, institution_id, all_members, allowed_by)
       values ($1,$2,$3,$4)
       on conflict (course_id, institution_id)
         do update set all_members = excluded.all_members, allowed_at = now()`,
      [body.courseId, body.institutionId, body.allMembers ?? false, me.id]
    )
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') {
      return NextResponse.json(
        { error: 'Run db/migrations/002-course-allowances.sql on this database first' },
        { status: 503 }
      )
    }
    throw e
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!pgConfigured) {
    return NextResponse.json({ error: 'Allowances need DATABASE_URL' }, { status: 500 })
  }
  const me = await operator(req)
  if (!me) return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Withdrawing a licence does not touch the grants an admin already made:
  // those rows stay, stop resolving, and start working again if the course is
  // re-allowed. Deleting someone's work to express "not licensed right now"
  // would be a surprising amount of damage for a toggle.
  await q('delete from simblip_course_allowances where id = $1', [id])
  return NextResponse.json({ ok: true })
}
