// The REAL stage end to end: the authored Ohm's-law lesson performed headlessly on
// the real stores and simulation runtime. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { perform } from '@/lib/lesson/player'
export { makeStage, bumpRun, currentRun } from '@/lib/lesson/stage'
export { useLesson } from '@/lib/lesson/store'
export { storyboardFromCourse } from '@/lib/lesson/from-course'
export { useDocStore } from '@/lib/store/document'
export { useLearner } from '@/lib/learning/store'
export { useWalkthroughStore } from '@/lib/store/walkthrough-store'
export { setCursorSpeed } from '@/lib/walkthrough/walkthrough-cursor-driver'
export { stop } from '@/lib/physics/world'
`,
  'lesson-stage'
)
const { perform, makeStage, bumpRun, currentRun, useLesson, storyboardFromCourse, useDocStore, useLearner, useWalkthroughStore, setCursorSpeed, stop } = m

test("performing the Ohm's-law lesson: scenes appear, formulas follow, wrong predictions become cards", async () => {
  const sb = storyboardFromCourse(JSON.parse(readFileSync('content/courses/enex-101/ohms-law.json', 'utf8')), 'enex-101/ohms-law')
  const pageId = 'p-lesson'
  useDocStore.getState().loadPage(pageId)
  useWalkthroughStore.setState({ muted: true, speed: 200 }) // narration becomes a (fast) timer
  setCursorSpeed(200)
  useLearner.setState({ cards: {}, mastery: {}, newToday: ['', 0] })
  useLearner.getState().setPrefs({ dailyNewCards: 50 })
  bumpRun()
  useLesson.getState().set({ active: true, storyboard: sb, pageId })

  let peak = 0, asked = 0, formulas = 0
  const watcher = setInterval(() => {
    const L = useLesson.getState()
    const objs = Object.values(useDocStore.getState().pages[pageId]?.objects ?? {})
    peak = Math.max(peak, objs.length)
    formulas = Math.max(formulas, objs.filter((o) => o.behaviors.length === 0 && 'latex' in o.parameters).length)
    if (L.pending && L.chosen === null) { asked++; L.set({ chosen: (L.pending.correct + 1) % L.pending.choices.length }) } // always wrong
  }, 20)

  const result = await perform(sb, makeStage(sb, pageId, currentRun()))
  clearInterval(watcher)
  stop()

  assert.equal(result, 'done')
  const predictions = sb.beats.filter((b) => b.t === 'predict').length
  assert.equal(asked, predictions, 'every prediction pauses for the student')
  assert.ok(peak > 3, `a simulation should have been drawn (peak ${peak} objects)`)
  assert.ok(Object.keys(useLearner.getState().cards).length > 0, 'missed predictions become flash cards')
  assert.ok(Object.values(useLearner.getState().cards).every((c) => c.type === 'predict' && c.link?.pageId === pageId))
  assert.ok(useLearner.getState().mastery[sb.title].evidence === predictions)
  assert.ok(useLearner.getState().mastery[sb.title].p < 0.3, 'all-wrong answers lower mastery')

  // The board keeps study notes for every section, and closes with a summary of them all.
  const secs = useLesson.getState().sections
  const last = secs[secs.length - 1]
  assert.equal(last.summary, true, 'the lesson ends with a Summary section')
  const real = secs.filter((x) => !x.summary)
  assert.ok(real.length >= 3, `sections were opened (${real.length})`)
  assert.ok(real.some((x) => (x.bullets?.length ?? 0) > 0), 'sections carry key points')
  assert.ok(real.some((x) => (x.formulas?.length ?? 0) > 0), 'formulas are listed per section')
  assert.ok(real.some((x) => (x.checks?.length ?? 0) > 0), 'questions are kept with their answers')
  const texts = Object.values(useDocStore.getState().pages[pageId].objects).map((o) => o.parameters.text?.value ?? '')
  assert.ok(texts.some((t) => t.includes('Key points')), 'a Key points block is on the board')
  assert.ok(texts.some((t) => /^\*\*1\./.test(t)), 'the summary block is on the board')
})
