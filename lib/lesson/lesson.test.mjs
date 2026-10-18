// Storyboard schema, lint, and the course converter against the REAL authored
// Ohm's-law lesson. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { storyboardFromCourse, plain, sentences } from '@/lib/lesson/from-course'
export { lintStoryboard, durationOf, storyboardSchema } from '@/lib/lesson/storyboard'
`,
  'lesson'
)
const { storyboardFromCourse, plain, sentences, lintStoryboard, durationOf, storyboardSchema } = m
const ohm = JSON.parse(readFileSync('content/courses/enex-101/ohms-law.json', 'utf8'))

test('plain() makes lesson HTML speakable', () => {
  assert.equal(plain('<p>Voltage (<i>V</i>) is <em class="term">pressure</em>.</p><p>Next.</p>'), 'Voltage (V) is pressure. Next.')
})
test('sentences() does not break on e.g. or decimals', () => {
  assert.deepEqual(sentences('Use e.g. a 9 V cell. It gives 27.3 mA. Done!'), ['Use e.g. a 9 V cell.', 'It gives 27.3 mA.', 'Done!'])
})

test("Ohm's law lesson becomes a lint-clean storyboard with scenes, equations and predictions", () => {
  const sb = storyboardFromCourse(ohm, 'enex-101/ohms-law')
  assert.deepEqual(lintStoryboard(sb), [])
  const kinds = new Set(sb.beats.map((b) => b.t))
  for (const k of ['title', 'say', 'scene', 'equation', 'predict']) assert.ok(kinds.has(k), `missing ${k}`)
  assert.ok(sb.beats.length <= 120)
  const p = sb.beats.find((b) => b.t === 'predict')
  assert.equal(p.responses.length, p.choices.length)
  assert.ok(p.correct >= 0 && p.correct < p.choices.length)
  const secs = durationOf(sb)
  assert.ok(secs > 60 && secs < 1800, `a film of ${secs}s`)
})

test('no section is cut inside a prediction when the cap bites', () => {
  const sb = storyboardFromCourse(ohm, 'x', { maxBeats: 30 })
  assert.ok(sb.beats.length <= 30)
  assert.notEqual(sb.beats.at(-1).t, 'title', 'must not end on a dangling chapter card')
})

test('every authored course lesson converts and lints (the whole library is film-ready)', () => {
  let n = 0
  const bad = []
  for (const c of readdirSync('content/courses')) {
    for (const f of readdirSync(`content/courses/${c}`)) {
      if (f === 'course.json' || !f.endsWith('.json')) continue
      const d = JSON.parse(readFileSync(`content/courses/${c}/${f}`, 'utf8'))
      if (!d.sections) continue
      n++
      try {
        const sb = storyboardFromCourse(d, `${c}/${f}`)
        const issues = lintStoryboard(sb)
        if (issues.length) bad.push(`${c}/${f}: ${issues[0]}`)
      } catch (e) { bad.push(`${c}/${f}: ${e.message.slice(0, 120)}`) }
    }
  }
  assert.ok(n > 20, `only ${n} lessons found`)
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length}/${n} failed`)
})

test('schema rejects malformed beats', () => {
  assert.equal(storyboardSchema.safeParse({ title: 'x', beats: [{ t: 'predict', id: 'a', prompt: 'p', choices: ['only'], correct: 0, responses: [] }] }).success, false)
  assert.equal(storyboardSchema.safeParse({ title: 'x', beats: [{ t: 'nope' }] }).success, false)
})
