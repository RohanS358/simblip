// Courses read straight from the repository.
//
// WHY. A course normally lives in Postgres: it is published there, granted to
// a room or a profile, and served scoped to whoever is asking. But the app has
// a perfectly good no-database mode (lib/data/db.ts's 'local'), and in it
// /api/courses answered `{ courses: [] }` — so an offline install, a fresh
// clone, or anyone running `next dev` without a DATABASE_URL saw an empty
// Courses panel and no way to read a lesson that is sitting right there in
// `content/courses/`. Authoring a lesson and being unable to open it without
// provisioning a database is the wrong shape for a teaching tool.
//
// So: no database → the repository IS the catalogue. The shapes returned here
// are the same ones the SQL path builds, so the route and the client cannot
// tell the difference.
//
// This is a FALLBACK, never a merge. When Postgres is configured it answers
// alone, grants and all — a deployment must not start leaking courses that
// nobody was granted just because the files happen to be in the image.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CourseDoc } from '@/lib/store/course'

export interface FileLesson {
  id: string
  course_id: string
  path: string
  title: string
  ord: number
}

export interface FileCourse {
  id: string
  code: string
  title: string
  subject: string
  semester: number | null
  version: number
  lessons: FileLesson[]
}

interface Manifest {
  id?: string
  code?: string
  title?: string
  subject?: string
  semester?: number | null
  published?: boolean
  order?: string[]
  lessons?: Record<string, { path?: string; title?: string }>
}

const CONTENT_DIR = join(process.cwd(), 'content', 'courses')

/** Parsed once in production (the files cannot change under a running
 *  deployment), re-read every call in development so an edit to a lesson shows
 *  up on reload rather than after a restart. */
let cached: { courses: FileCourse[]; docs: Map<string, { title: string; doc: CourseDoc }> } | null = null

function read(): { courses: FileCourse[]; docs: Map<string, { title: string; doc: CourseDoc }> } {
  if (cached && process.env.NODE_ENV === 'production') return cached

  const courses: FileCourse[] = []
  const docs = new Map<string, { title: string; doc: CourseDoc }>()

  if (!existsSync(CONTENT_DIR)) return (cached = { courses, docs })

  for (const dir of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const root = join(CONTENT_DIR, dir.name)
    const manifestPath = join(root, 'course.json')
    if (!existsSync(manifestPath)) continue

    let manifest: Manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
    } catch {
      // A malformed manifest skips its course rather than taking the whole
      // panel down — the lint gate is where a broken file gets reported.
      continue
    }
    // `published: false` means "authored, not ready", and it means that here
    // exactly as it does in the database.
    if (manifest.published === false) continue

    const id = manifest.id ?? dir.name
    // `order` fixes the lesson sequence; anything present but unlisted is
    // appended, so a lesson added to the directory still appears.
    const listed = manifest.order ?? []
    const onDisk = readdirSync(root)
      .filter((f) => f.endsWith('.json') && f !== 'course.json')
      .map((f) => f.replace(/\.json$/, ''))
    const ids = [...listed.filter((l) => onDisk.includes(l)), ...onDisk.filter((l) => !listed.includes(l))]

    const lessons: FileLesson[] = []
    ids.forEach((lessonId, i) => {
      let doc: CourseDoc
      try {
        doc = JSON.parse(readFileSync(join(root, `${lessonId}.json`), 'utf8')) as CourseDoc
      } catch {
        return
      }
      const meta = manifest.lessons?.[lessonId] ?? {}
      const title = meta.title ?? doc.title ?? lessonId
      lessons.push({ id: lessonId, course_id: id, path: meta.path ?? '', title, ord: i })
      docs.set(lessonId, { title, doc })
    })
    if (lessons.length === 0) continue

    courses.push({
      id,
      code: manifest.code ?? id,
      title: manifest.title ?? id,
      subject: manifest.subject ?? '',
      semester: manifest.semester ?? null,
      // The database versions a course on every publish; a checkout has one
      // version, the one you are looking at.
      version: 1,
      lessons,
    })
  }

  courses.sort((a, b) => (a.semester ?? 99) - (b.semester ?? 99) || a.code.localeCompare(b.code))
  cached = { courses, docs }
  return cached
}

/** Every course in the repository, with its lessons (titles and paths only). */
export function coursesFromFiles(): FileCourse[] {
  return read().courses
}

/** One lesson's CourseDoc, or null. */
export function lessonFromFiles(id: string): { id: string; title: string; doc: CourseDoc } | null {
  const hit = read().docs.get(id)
  return hit ? { id, title: hit.title, doc: hit.doc } : null
}
