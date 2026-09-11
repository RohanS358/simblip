// A lesson round-trips through the page's `flow` field, and a malformed one
// degrades to the empty state instead of throwing during render.
//
// Bundled with esbuild the same way simscript-lint.test.mjs is, so the real
// module runs rather than a copy of its logic.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'course-'))
const bundle = join(dir, 'course.mjs')
const entry = join(dir, 'entry.ts')
// The doc store rides along so a test can corrupt `flow` the way a truncated
// sync or a bad import would, rather than only through writeCourse().
writeFileSync(entry, `
export { readCourse, writeCourse } from ${JSON.stringify(resolve(import.meta.dirname, 'course-content.ts'))}
export { useDocStore } from ${JSON.stringify(resolve(import.meta.dirname, 'document.ts'))}
`)
execFileSync('npx', ['esbuild', entry,
  '--bundle', '--format=esm', '--outfile=' + bundle,
  '--alias:@=' + resolve(import.meta.dirname, '../..')], { stdio: 'pipe' })
const { readCourse, writeCourse, useDocStore } = await import(bundle)

const LESSON = {
  title: 'The Simple Pendulum',
  kicker: 'Oscillations · Lesson 4',
  sections: [
    { id: 's1', title: 'Introduction', locator: '1', body: '<p>Hello.</p>' },
    {
      id: 's2', title: 'One swing', locator: '2',
      figures: [{ id: 'f1', caption: 'Figure 2.1', script: 'var a = create("mass", {});' }],
    },
  ],
}

test('a lesson round-trips through the page flow field', () => {
  writeCourse('p1', LESSON)
  const back = readCourse('p1')
  assert.equal(back.title, 'The Simple Pendulum')
  assert.equal(back.sections.length, 2)
  assert.equal(back.sections[1].figures[0].script, 'var a = create("mass", {});')
})

test('a page with no lesson reads as null, not a throw', () => {
  assert.equal(readCourse('never-written'), null)
})

test('malformed JSON degrades to the empty state instead of throwing', () => {
  // Corrupt the flow field directly, as a truncated sync or a bad import
  // would: readCourse must return null rather than throw mid-render.
  writeCourse('p2', LESSON)
  useDocStore.setState((s) => ({
    pages: { ...s.pages, p2: { ...s.pages.p2, flow: '{"sections":[' } },
  }))
  assert.equal(readCourse('p2'), null)
})

test('a JSON payload without a sections array is rejected', () => {
  writeCourse('p3', { title: 'No sections' })
  assert.equal(readCourse('p3'), null)
})

rmSync(dir, { recursive: true, force: true })
