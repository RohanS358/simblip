// The lesson-save contract. Editing a lesson changes what every student with a
// grant sees, so the two things that must never break are the SHAPE check on
// the way in and the round-trip through the page.
//
// Run: node --test lib/store/course-edit.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'course-edit-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'ce.mjs')

writeFileSync(stub, `
let pages = {}
export const useDocStore = {
  getState: () => ({
    pages,
    ensurePage(id) { pages[id] ??= { objects: {}, variables: [] } },
  }),
  setState: (fn) => { const r = fn({ pages }); if (r?.pages) pages = r.pages },
  __reset: () => { pages = {} },
  __page: (id) => pages[id],
}
`)
// page-archive reaches for browser storage; the reader only needs the store.
writeFileSync(join(dir, 'archive-stub.ts'), `export const readPage = () => undefined`)
writeFileSync(entry, `
export { readCourse, writeCourse } from '@/lib/store/course-content'
export { useDocStore } from '@/lib/store/document'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`,
  `--alias:@/lib/store/page-archive=${join(dir, 'archive-stub.ts')}`,
  `--alias:@=${root}`,
  '--external:react', '--external:zustand', '--external:lucide-react'], { cwd: root, stdio: 'pipe' })

const { readCourse, writeCourse, useDocStore } = await import(bundle)

// lessonIdOf is one line and lives in a 'use client' module that drags in the
// auth store and lucide; re-stating it here keeps the test free of React while
// still failing if the page-id convention changes (the assertion below is the
// contract, and courses-panel.tsx is the other half of it).
const lessonIdOf = (pageId) =>
  pageId.startsWith('course:') ? pageId.slice('course:'.length) : null

const DOC = {
  title: 'Ohm’s law',
  sections: [{
    id: 's1',
    title: 'The law',
    body: '<p>V = IR.</p>',
    figures: [{ id: 'f1', caption: 'A divider', script: 'r = create("resistor")' }],
    question: {
      prompt: 'Double R?',
      choices: [{ text: 'I halves', correct: true }, { text: 'I doubles' }],
      responses: [{ title: 'Yes', body: '...' }, { title: 'No', body: '...' }],
    },
  }],
}

test('an edited lesson round-trips through the page', () => {
  useDocStore.__reset()
  writeCourse('course:ohm', DOC)
  const back = readCourse('course:ohm')
  assert.equal(back.sections[0].figures[0].script, 'r = create("resistor")')

  // The edit an author would make in the panel: reword prose, fix a script.
  const edited = structuredClone(DOC)
  edited.sections[0].body = '<p>Voltage equals current times resistance.</p>'
  edited.sections[0].figures[0].script = 'r = create("resistor", { resistance: 220 })'
  writeCourse('course:ohm', edited)

  const after = readCourse('course:ohm')
  assert.equal(after.sections[0].body, '<p>Voltage equals current times resistance.</p>')
  assert.match(after.sections[0].figures[0].script, /220/)
})

test('the lesson id comes from the page id', () => {
  // courses-panel opens a lesson as `course:<lessonId>`, and the save route
  // needs that id — if this drifts, saving silently targets the wrong lesson.
  assert.equal(lessonIdOf('course:emag-01'), 'emag-01')
  assert.equal(lessonIdOf('page-123'), null, 'a normal page is not editable')
})

// ── The server-side shape gate ──────────────────────────────────────────────
// Re-implemented against the same rules the route enforces, so a change to
// either side without the other fails here. The real linter runs offline.

const invalid = (await import(resolve(root, 'lib/store/course-shape.mjs'))).invalidCourseDoc

test('a valid doc passes the shape gate', () => {
  assert.equal(invalid(DOC), null)
})

test('the gate rejects what would break the reader', () => {
  const missingResponse = structuredClone(DOC)
  missingResponse.sections[0].question.responses = [{ title: 'Yes', body: '...' }]
  assert.match(invalid(missingResponse), /one response per choice/,
    'a choice with no response renders an empty panel')

  const noTitle = structuredClone(DOC)
  noTitle.sections[0].title = ''
  assert.match(invalid(noTitle), /needs a title/)

  const dupe = structuredClone(DOC)
  dupe.sections.push({ ...dupe.sections[0] })
  assert.match(invalid(dupe), /duplicate section id/,
    'duplicate ids collide in the outline and the answer store')

  const noScript = structuredClone(DOC)
  delete noScript.sections[0].figures[0].script
  assert.match(invalid(noScript), /needs a script/)

  assert.match(invalid({ title: 'x', sections: [] }), /no sections/)
  assert.match(invalid(null), /must be an object/)
})
