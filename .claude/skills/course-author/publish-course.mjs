#!/usr/bin/env node
// Push an authored course into the database.
//
//   node --env-file=.env.local .claude/skills/course-author/publish-course.mjs content/courses/<course>/
//
// A course directory holds `course.json` (the catalogue entry) plus one JSON
// file per lesson. Every lesson is RE-LINTED here before anything is written —
// publishing is the last place the gate can still stop a broken lesson, and it
// costs a couple of seconds.
//
// Writes DIRECTLY to DATABASE_URL rather than through /api/courses/publish.
// The HTTP route exists for a future console; from a checkout the person
// running this already owns the repo and the database, so a shared secret
// would only be a hoop to jump through — and one more thing to leak.
//
// --dry-run validates and prints the payload summary without writing.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const dir = args.find((a) => !a.startsWith('--'))

if (!dir) {
  console.error('usage: publish-course.mjs <course-dir> [--dry-run]')
  process.exit(2)
}

const root = resolve(dir)
const manifestPath = join(root, 'course.json')
if (!existsSync(manifestPath)) {
  console.error(`no course.json in ${dir} — a course directory needs one`)
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const lessonFiles = readdirSync(root)
  .filter((f) => f.endsWith('.json') && f !== 'course.json')
  .sort()

if (lessonFiles.length === 0) {
  console.error(`no lesson files in ${dir}`)
  process.exit(2)
}

// ── Gate ────────────────────────────────────────────────────────────────────
// The same linter the authoring workflow runs. Publishing without it would
// make the gate optional in the one place it matters most.
console.log(`Linting ${lessonFiles.length} lesson(s)…`)
try {
  execFileSync(
    process.execPath,
    [join(import.meta.dirname, 'lint-course.mjs'), ...lessonFiles.map((f) => join(root, f))],
    { stdio: 'inherit' }
  )
} catch {
  console.error('\nLint failed — nothing published.')
  process.exit(1)
}

// ── Payload ─────────────────────────────────────────────────────────────────
// `order` in the manifest, when present, fixes lesson sequence explicitly;
// otherwise filename order stands. `path` is the syllabus position that builds
// the tree the reader shows.
const order = manifest.order ?? null
const lessons = lessonFiles.map((file, i) => {
  const doc = JSON.parse(readFileSync(join(root, file), 'utf8'))
  const slug = basename(file, '.json')
  const meta = (manifest.lessons ?? {})[slug] ?? {}
  return {
    id: `${manifest.id}/${slug}`,
    path: meta.path ?? '',
    title: meta.title ?? doc.title ?? slug,
    ord: order ? Math.max(0, order.indexOf(slug)) : i,
    doc,
  }
})

const payload = {
  id: manifest.id,
  code: manifest.code,
  title: manifest.title,
  subject: manifest.subject,
  semester: manifest.semester,
  description: manifest.description,
  published: manifest.published ?? true,
  lessons,
}

console.log(`\n${payload.code} — ${payload.title}`)
for (const l of lessons) {
  console.log(`   ${l.path ? l.path + ' / ' : ''}${l.title}  (${l.doc.sections.length} sections)`)
}

if (dryRun) {
  console.log('\n--dry-run: validated, nothing sent.')
  process.exit(0)
}

// ── Write ───────────────────────────────────────────────────────────────────
const url = process.env.DATABASE_URL
if (!url) {
  console.error(
    '\nDATABASE_URL is not set.\n' +
      'Run with:  node --env-file=.env.local .claude/skills/course-author/publish-course.mjs <dir>'
  )
  process.exit(2)
}

const { Client } = await import('pg')
const db = new Client({ connectionString: url })
try {
  await db.connect()
} catch (e) {
  console.error(`\nCould not reach the database: ${e.message}`)
  process.exit(1)
}

try {
  await db.query('begin')

  await db.query(
    `insert into simblip_courses (id, code, title, subject, semester, description, published, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (id) do update set
       code = excluded.code, title = excluded.title, subject = excluded.subject,
       semester = excluded.semester, description = excluded.description,
       published = excluded.published,
       version = simblip_courses.version + 1,
       updated_at = now()`,
    [payload.id, payload.code, payload.title, payload.subject ?? 'general',
     payload.semester ?? null, payload.description ?? null, payload.published]
  )

  // Replace the lesson set: a lesson removed upstream must stop being served,
  // which "upsert each" would silently fail to do.
  await db.query('delete from simblip_course_lessons where course_id = $1', [payload.id])
  for (const l of lessons) {
    await db.query(
      `insert into simblip_course_lessons (id, course_id, path, title, ord, doc, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())`,
      [l.id, payload.id, l.path, l.title, l.ord, JSON.stringify(l.doc)]
    )
  }

  await db.query('commit')

  const { rows } = await db.query('select version from simblip_courses where id = $1', [payload.id])
  console.log(`\nPublished — ${lessons.length} lesson(s), version ${rows[0].version}.`)

  // Say plainly whether anyone can see it yet: publishing makes a course
  // exist, a grant makes it visible, and forgetting the second is the
  // obvious way to think publishing silently failed.
  const { rows: g } = await db.query(
    'select count(*)::int as n from simblip_course_grants where course_id = $1',
    [payload.id]
  )
  console.log(
    g[0].n > 0
      ? `Visible to ${g[0].n} existing grant(s).`
      : 'No grants yet — nobody can see it. Grant it to a room or a profile to make it visible.'
  )
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error(`\nPublish failed, nothing written: ${e.message}`)
  process.exit(1)
} finally {
  await db.end()
}
