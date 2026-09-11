import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'
// One copy of the rules, shared with lib/store/course-edit.test.mjs.
import { invalidCourseDoc } from '@/lib/store/course-shape.mjs'

// PUT /api/courses/lesson — save ONE lesson's CourseDoc in place.
//
// WHY NOT /api/courses/publish. That route replaces a course wholesale: it
// deletes every lesson and re-inserts what the caller sent, which is right for
// the offline authoring workflow (the checkout is the source of truth) and
// catastrophic here — the reader holds one lesson, so publishing from it would
// delete every sibling in the course.
//
// AUTH: super_admin only, the same bar as publishing. Editing a published
// lesson changes what every student with a grant sees, so it is a platform
// action, not a teacher one.
//
// The offline authoring gate (.claude/skills/course-author/lint-course.mjs)
// still owns real validation — it runs the SimScript linter over every figure.
// This route re-checks SHAPE only, so a malformed doc cannot land in the table
// and break the reader for everyone. An edit made here is therefore a fix or a
// tweak; a new lesson still comes from the authoring workflow.

interface Body {
  lessonId: string
  /** The CourseDoc (lib/store/course.ts). */
  doc: unknown
  /** Optional metadata edits — the lesson's own row, not the doc. */
  title?: string
  path?: string
}

export async function PUT(req: Request) {
  if (!pgConfigured) {
    return NextResponse.json({ error: 'Editing requires DATABASE_URL' }, { status: 500 })
  }

  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [caller] = await q<{ role: string; active: boolean }>(
    'select role, active from simblip_profiles where id = $1',
    [claims.sub]
  )
  if (!caller?.active || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  if (!body?.lessonId) {
    return NextResponse.json({ error: 'lessonId is required' }, { status: 400 })
  }

  const bad = invalidCourseDoc(body.doc)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  // Update rather than upsert: this route edits an EXISTING lesson. Creating
  // one here would let a typo'd id quietly spawn an orphan with no course.
  const rows = await q<{ id: string }>(
    `update simblip_course_lessons
        set doc = $2,
            title = coalesce($3, title),
            path = coalesce($4, path),
            updated_at = now()
      where id = $1
      returning id`,
    [body.lessonId, JSON.stringify(body.doc), body.title ?? null, body.path ?? null]
  )
  if (!rows[0]) {
    return NextResponse.json({ error: 'No such lesson' }, { status: 404 })
  }

  // Bump the course version so a client caching the syllabus notices.
  await q(
    `update simblip_courses set version = version + 1, updated_at = now()
      where id = (select course_id from simblip_course_lessons where id = $1)`,
    [body.lessonId]
  )

  return NextResponse.json({ ok: true, lessonId: body.lessonId, savedBy: claims.sub })
}
