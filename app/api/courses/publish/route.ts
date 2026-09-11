import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'

// Publish a course and its lessons. The DEV tier of docs/course-mode.md:
// lessons are authored offline, lint-gated, then pushed here.
//
// AUTH: a super_admin bearer token. There is no shared publish secret — the
// authoring workflow writes to the database directly
// (.claude/skills/course-author/publish-course.mjs), because whoever runs it
// from a checkout already owns the repo and the database. This route is for a
// future admin console, where a real session exists to authenticate with.
//
// Lessons are replaced wholesale per course: a course's lesson set is
// whatever the publisher just sent, so a lesson removed upstream disappears
// here too. That is the point of publishing the whole course rather than
// patching lessons one at a time.

interface LessonIn {
  id: string
  /** Syllabus position: 'DC Circuits/Ohm's law'. '' = top level. */
  path?: string
  title: string
  ord?: number
  /** The CourseDoc (lib/store/course.ts). */
  doc: unknown
}

interface CourseIn {
  id: string
  code: string
  title: string
  subject?: string
  semester?: number
  description?: string
  published?: boolean
  lessons: LessonIn[]
}

function authorize(req: Request): Promise<{ ok: true; by: string } | { ok: false; status: number; error: string }> {
  const claims = bearerClaims(req)
  if (!claims) {
    return Promise.resolve({ ok: false as const, status: 401, error: 'Unauthorized' })
  }
  return q<{ role: string; active: boolean }>(
    'select role, active from simblip_profiles where id = $1',
    [claims.sub]
  ).then((rows) => {
    const caller = rows[0]
    if (!caller?.active || caller.role !== 'super_admin') {
      return { ok: false as const, status: 403, error: 'Platform admin access required' }
    }
    return { ok: true as const, by: claims.sub }
  })
}

/** Everything that makes a lesson worth shipping is checked by the authoring
 *  gate (.claude/skills/course-author/lint-course.mjs), which runs the real
 *  SimScript linter. This is the narrower server-side check: shape only, so a
 *  malformed payload cannot land in the table and break every reader. */
function invalid(course: CourseIn): string | null {
  if (!course?.id || !/^[a-z0-9][a-z0-9-]*$/.test(course.id)) {
    return 'course.id must be a lowercase slug'
  }
  if (!course.code || !course.title) return 'course needs a code and a title'
  if (!Array.isArray(course.lessons) || course.lessons.length === 0) {
    return 'course needs at least one lesson'
  }
  const seen = new Set<string>()
  for (const l of course.lessons) {
    if (!l?.id) return 'every lesson needs an id'
    if (seen.has(l.id)) return `duplicate lesson id "${l.id}"`
    seen.add(l.id)
    if (!l.title) return `lesson "${l.id}" needs a title`
    const doc = l.doc as { sections?: unknown } | null
    if (!doc || !Array.isArray(doc.sections) || doc.sections.length === 0) {
      return `lesson "${l.id}" has no sections — is this a CourseDoc?`
    }
  }
  return null
}

export async function POST(req: Request) {
  if (!pgConfigured) {
    return NextResponse.json({ error: 'Publishing requires DATABASE_URL' }, { status: 500 })
  }

  const auth = await authorize(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let course: CourseIn
  try {
    course = (await req.json()) as CourseIn
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const bad = invalid(course)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  await q(
    `insert into simblip_courses (id, code, title, subject, semester, description, published, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (id) do update set
       code = excluded.code, title = excluded.title, subject = excluded.subject,
       semester = excluded.semester, description = excluded.description,
       published = excluded.published,
       version = simblip_courses.version + 1,
       updated_at = now()`,
    [
      course.id,
      course.code,
      course.title,
      course.subject ?? 'general',
      course.semester ?? null,
      course.description ?? null,
      course.published ?? true,
    ]
  )

  // Replace the lesson set. Deleting first means a lesson dropped upstream
  // stops being served, which "upsert each" would silently fail to do.
  await q('delete from simblip_course_lessons where course_id = $1', [course.id])
  for (const [i, l] of course.lessons.entries()) {
    await q(
      `insert into simblip_course_lessons (id, course_id, path, title, ord, doc, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())`,
      [l.id, course.id, l.path ?? '', l.title, l.ord ?? i, JSON.stringify(l.doc)]
    )
  }

  const [{ version }] = await q<{ version: number }>(
    'select version from simblip_courses where id = $1',
    [course.id]
  )

  return NextResponse.json({
    ok: true,
    courseId: course.id,
    lessons: course.lessons.length,
    version,
    publishedBy: auth.by,
  })
}
