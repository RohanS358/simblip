// The no-database course catalogue: the repository's own content/courses.
// Run: node --test lib/server/course-files.test.mjs
//
// This reads the REAL content directory rather than a fixture, which is the
// point: it fails if an authored course stops being servable — a manifest that
// no longer parses, an `order` entry naming a file that is not there, a lesson
// whose JSON broke. Those are exactly the faults that would show up as an
// empty Courses panel with nothing in the log.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'course-files-'))
const bundle = join(dir, 'cf.mjs')
execFileSync('npx', ['esbuild', resolve(root, 'lib/server/course-files.ts'), '--bundle',
  '--format=esm', '--platform=node', `--outfile=${bundle}`, `--alias:@=${root}`],
  { cwd: root, stdio: 'pipe' })

/** The module resolves content/ against cwd, so each case runs from a chosen
 *  root — the repo itself, or a scratch directory built for one assertion. */
const readFrom = async (cwd) => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const m = await import(${JSON.stringify('file://' + bundle)})
    const courses = m.coursesFromFiles()
    process.stdout.write(JSON.stringify({
      courses,
      adders: m.lessonFromFiles('adders')?.doc?.sections?.length ?? null,
      missing: m.lessonFromFiles('no-such-lesson'),
    }))
  `], { cwd, encoding: 'utf8' })
  return JSON.parse(out)
}

test('every authored course in the repo is servable without a database', async () => {
  const { courses } = await readFrom(root)
  assert.ok(courses.length >= 2, `expected the repo's courses, got ${courses.length}`)
  for (const c of courses) {
    assert.ok(c.id && c.code && c.title, `course ${c.id} is missing catalogue fields`)
    assert.ok(c.lessons.length > 0, `course ${c.id} lists no lessons`)
    for (const l of c.lessons) {
      assert.equal(l.course_id, c.id)
      assert.ok(l.title, `lesson ${l.id} has no title`)
    }
  }
})

test('a lesson comes back as a real CourseDoc', async () => {
  const { adders, missing } = await readFrom(root)
  assert.ok(adders >= 8, `the adders lesson should have its sections, got ${adders}`)
  assert.equal(missing, null, 'an unknown lesson id must be null, not a guess')
})

test('courses are ordered by semester, and lessons by the manifest order', async () => {
  const { courses } = await readFrom(root)
  const sems = courses.map((c) => c.semester ?? 99)
  assert.deepEqual(sems, [...sems].sort((a, b) => a - b), 'catalogue is not semester-ordered')
  for (const c of courses) {
    assert.deepEqual(c.lessons.map((l) => l.ord), c.lessons.map((_, i) => i))
  }
})

test('an unpublished course is withheld, exactly as the database withholds it', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'course-scratch-'))
  const draft = join(scratch, 'content', 'courses', 'draft-101')
  mkdirSync(draft, { recursive: true })
  writeFileSync(join(draft, 'course.json'), JSON.stringify({
    id: 'draft-101', code: 'DRAFT 101', title: 'Not ready', subject: 'x',
    semester: 1, published: false, order: ['one'], lessons: { one: { path: 'U', title: 'One' } },
  }))
  writeFileSync(join(draft, 'one.json'), JSON.stringify({ title: 'One', sections: [{ id: 'a', title: 'A' }] }))
  try {
    const { courses } = await readFrom(scratch)
    assert.equal(courses.length, 0, 'a course marked published:false must not be served')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('a lesson on disk but missing from `order` is still served, at the end', async () => {
  // Forgetting to add a new lesson to the manifest should cost you its
  // position, not its existence — an authored lesson that silently does not
  // appear is the failure this whole file exists to catch.
  const scratch = mkdtempSync(join(tmpdir(), 'course-scratch-'))
  const c = join(scratch, 'content', 'courses', 'x-1')
  mkdirSync(c, { recursive: true })
  writeFileSync(join(c, 'course.json'), JSON.stringify({
    id: 'x-1', code: 'X 1', title: 'X', subject: 'x', semester: 1,
    order: ['first'], lessons: { first: { path: 'U', title: 'First' } },
  }))
  const doc = (t) => JSON.stringify({ title: t, sections: [{ id: 'a', title: 'A' }] })
  writeFileSync(join(c, 'first.json'), doc('First'))
  writeFileSync(join(c, 'forgotten.json'), doc('Forgotten'))
  try {
    const { courses } = await readFrom(scratch)
    assert.deepEqual(courses[0].lessons.map((l) => l.id), ['first', 'forgotten'])
    // With no manifest entry it falls back to the document's own title.
    assert.equal(courses[0].lessons[1].title, 'Forgotten')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('a broken manifest skips its course instead of taking the panel down', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'course-scratch-'))
  const bad = join(scratch, 'content', 'courses', 'bad')
  const good = join(scratch, 'content', 'courses', 'good')
  mkdirSync(bad, { recursive: true })
  mkdirSync(good, { recursive: true })
  writeFileSync(join(bad, 'course.json'), '{ this is not json')
  writeFileSync(join(good, 'course.json'), JSON.stringify({
    id: 'good', code: 'G 1', title: 'Good', subject: 'x', semester: 1,
    order: ['one'], lessons: { one: { path: 'U', title: 'One' } },
  }))
  writeFileSync(join(good, 'one.json'), JSON.stringify({ title: 'One', sections: [{ id: 'a', title: 'A' }] }))
  try {
    const { courses } = await readFrom(scratch)
    assert.deepEqual(courses.map((c) => c.id), ['good'])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
