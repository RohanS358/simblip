import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'

// What courses may this profile open, and what is in them.
//
//   GET /api/courses            → the caller's courses, semester-grouped,
//                                 each with its lesson TREE (titles only)
//   GET /api/courses?lesson=ID  → one lesson's CourseDoc
//
// A course reaches a profile two ways (docs/course-mode.md): granted to them
// directly, or granted to a room they belong to. Both are resolved here rather
// than in the client, so a client can never ask for a lesson it was not given.

interface LessonRow {
  id: string
  course_id: string
  path: string
  title: string
  ord: number
}

/** A node of the syllabus tree: units nest, lessons are leaves. */
interface Node {
  name: string
  lessons: { id: string; title: string }[]
  children: Node[]
}

/** Build the tree from each lesson's '/'-separated path. Storing the path and
 *  deriving the tree keeps a lesson movable by editing one field. */
function treeOf(rows: LessonRow[]): Node[] {
  const root: Node = { name: '', lessons: [], children: [] }
  for (const r of rows) {
    let node = root
    for (const part of (r.path || '').split('/').filter(Boolean)) {
      let next = node.children.find((c) => c.name === part)
      if (!next) {
        next = { name: part, lessons: [], children: [] }
        node.children.push(next)
      }
      node = next
    }
    node.lessons.push({ id: r.id, title: r.title })
  }
  return root.children.length || root.lessons.length
    ? [...root.children, ...(root.lessons.length ? [{ name: '', lessons: root.lessons, children: [] }] : [])]
    : []
}

export async function GET(req: Request) {
  if (!pgConfigured) return NextResponse.json({ courses: [] })

  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Course ids this profile may open: granted to them, or to a room they are in.
  //
  // A deployment whose schema predates Course Mode has no course tables yet
  // (42P01). That is "no courses", not a server fault — surfacing a 500 would
  // put a raw error in front of a student for a migration they cannot run.
  let granted: { course_id: string }[]
  try {
    granted = await q<{ course_id: string }>(
      `select distinct g.course_id
         from simblip_course_grants g
         left join simblip_room_members m on m.room_id = g.target_room_id
        where g.target_profile_id = $1
           or m.profile_id = $1`,
      [claims.sub]
    )
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return NextResponse.json({ courses: [] })
    throw e
  }
  const ids = granted.map((g) => g.course_id)
  if (ids.length === 0) return NextResponse.json({ courses: [] })

  const lessonId = new URL(req.url).searchParams.get('lesson')
  if (lessonId) {
    // Scoped to the granted ids, so a guessed lesson id returns nothing.
    const rows = await q<{ id: string; title: string; doc: unknown }>(
      `select id, title, doc from simblip_course_lessons
        where id = $1 and course_id = any($2)`,
      [lessonId, ids]
    )
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ lesson: rows[0] })
  }

  const courses = await q<{
    id: string
    code: string
    title: string
    subject: string
    semester: number | null
    version: number
  }>(
    `select id, code, title, subject, semester, version
       from simblip_courses
      where id = any($1) and published
      order by semester nulls last, code`,
    [ids]
  )

  const lessons = await q<LessonRow>(
    `select id, course_id, path, title, ord
       from simblip_course_lessons
      where course_id = any($1)
      order by path, ord`,
    [courses.map((c) => c.id)]
  )

  return NextResponse.json({
    courses: courses.map((c) => ({
      ...c,
      tree: treeOf(lessons.filter((l) => l.course_id === c.id)),
    })),
  })
}
