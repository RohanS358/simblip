// Learning engine: scheduler, hint ladder, mastery, card lint, BM25, and the
// learn.* tools against the REAL learner store.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(
  `
export { review, newFsrs, retrievability } from '@/lib/learning/fsrs'
export { nextRung } from '@/lib/learning/hints'
export { updateMastery, weakest } from '@/lib/learning/mastery'
export { lintCard } from '@/lib/learning/cards'
export { bm25 } from '@/lib/learning/bm25'
export { useLearner } from '@/lib/learning/store'
export { runTool } from '@/lib/tools/registry'
import '@/lib/tools/learn'
export { setCourseCorpus } from '@/lib/tools/learn'
`,
  'learning'
)
const { review, newFsrs, retrievability, nextRung, updateMastery, weakest, lintCard, bm25, useLearner, runTool, setCourseCorpus } = m
const DAY = 86_400_000

test('FSRS: success spaces reviews further apart, Again resets within the day', () => {
  let c = newFsrs(0)
  let t = 0
  const gaps = []
  for (let i = 0; i < 4; i++) {
    c = review(c, 3, t)
    gaps.push(c.due - t)
    t = c.due
  }
  assert.ok(gaps[1] > gaps[0] && gaps[2] > gaps[1] && gaps[3] > gaps[2], `intervals must grow: ${gaps.map((g) => (g / DAY).toFixed(1))}`)
  const lapsed = review(c, 1, t)
  assert.ok(lapsed.due - t < DAY / 2, 'Again returns within hours')
  assert.equal(lapsed.lapses, 1)
  assert.ok(lapsed.stability < c.stability)
})

test('FSRS: easy beats good beats hard; retrievability is 0.9 at one stability-interval', () => {
  const base = review(newFsrs(0), 3, 0)
  const at = base.due
  const [h, g, e] = [2, 3, 4].map((r) => review(base, r, at).stability)
  assert.ok(h < g && g < e)
  assert.ok(Math.abs(retrievability(base.stability, base.stability) - 0.9) < 1e-9)
})

test('hint ladder climbs one rung at a time and saturates', () => {
  let r
  const seen = []
  for (let i = 0; i < 7; i++) { r = nextRung(r); seen.push(r) }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 4, 4])
})

test('mastery: needing hints earns less credit; wrong answers lower it', () => {
  const clean = updateMastery(undefined, 'kcl', true, 0, 1)
  const helped = updateMastery(undefined, 'kcl', true, 4, 1)
  const wrong = updateMastery(clean, 'kcl', false, 0, 2)
  assert.ok(clean.p > helped.p)
  assert.ok(wrong.p < clean.p)
  assert.equal(weakest([clean, helped, wrong], 1)[0].p, Math.min(clean.p, helped.p, wrong.p))
})

test('card lint: referent-less, multi-question, blank-less cloze and unlinked predict cards are rejected', () => {
  assert.deepEqual(lintCard({ type: 'basic', front: 'Unit of capacitance?', back: 'Farad' }), [])
  assert.ok(lintCard({ type: 'basic', front: 'It stores charge. What is it?', back: 'x' }).length)
  assert.ok(lintCard({ type: 'basic', front: 'What is V? What is I?', back: 'x' }).length)
  assert.ok(lintCard({ type: 'cloze', front: 'Range is v squared sin 2 theta over g', back: 'g' }).length)
  assert.ok(lintCard({ type: 'predict', front: 'Double the spring constant: period up or down?', back: 'down' }).length)
})

test('BM25 ranks the relevant section first and returns nothing for noise', () => {
  const docs = [
    { id: 'a', title: 'Projectile motion', text: 'range of a projectile depends on launch angle and speed' },
    { id: 'b', title: 'Op-amp', text: 'inverting amplifier gain is minus Rf over Rin' },
    { id: 'c', title: 'Diodes', text: 'a rectifier converts alternating current to direct current' },
  ]
  assert.equal(bm25(docs, 'launch angle of a projectile')[0].doc.id, 'a')
  assert.equal(bm25(docs, 'rectifier')[0].doc.id, 'c')
  assert.deepEqual(bm25(docs, 'zzzz'), [])
})

test('learn tools: create → due → grade reschedules; bad cards are refused', async () => {
  const ctx = { pageId: 'p1' }
  const bad = await runTool('learn.cards.create', { conceptId: 'cap', front: 'It is?', back: 'x' }, ctx)
  assert.equal(bad.ok, false)
  const made = await runTool('learn.cards.create', { conceptId: 'cap', front: 'Unit of capacitance?', back: 'Farad (F = C/V)' }, ctx)
  assert.equal(made.ok, true)
  const next = await runTool('learn.cards.next', {}, ctx)
  assert.equal(next.data.card.id, made.data.id)
  assert.equal((await runTool('learn.cards.grade', { cardId: made.data.id, rating: 3 }, ctx)).ok, true)
  assert.equal((await runTool('learn.cards.next', {}, ctx)).data.card, null)
  assert.equal(useLearner.getState().mastery.cap.evidence, 1)
})

test('daily new-card cap is enforced', async () => {
  useLearner.setState({ cards: {}, newToday: ['', 0] })
  useLearner.getState().setPrefs({ dailyNewCards: 2 })
  const mk = (i) => runTool('learn.cards.create', { conceptId: 'x', front: `Question number ${i} about x?`, back: 'a' }, { pageId: null })
  assert.equal((await mk(1)).ok, true)
  assert.equal((await mk(2)).ok, true)
  assert.equal((await mk(3)).ok, false)
})

test('hint tool honours Answer mode and climbs in Learn mode; mnemonic acronym is checked', async () => {
  const ctx = { pageId: null }
  useLearner.getState().setPrefs({ mode: 'learn' })
  assert.equal((await runTool('learn.hint', { questionId: 'q1' }, ctx)).data.rung, 0)
  assert.equal((await runTool('learn.hint', { questionId: 'q1' }, ctx)).data.rung, 1)
  useLearner.getState().setPrefs({ mode: 'answer' })
  assert.equal((await runTool('learn.hint', { questionId: 'q1' }, ctx)).data.rung, null)
  const items = ['Voltage', 'Current', 'Resistance']
  assert.equal((await runTool('learn.mnemonic', { items, acronym: 'VCR' }, ctx)).ok, true)
  assert.equal((await runTool('learn.mnemonic', { items, acronym: 'CAT' }, ctx)).ok, false)
})

test('course.search returns grounded excerpts, and refuses honestly on no match', async () => {
  setCourseCorpus(async () => [{ id: 's1', title: 'Kirchhoff', text: 'sum of currents at a node is zero', lessonId: 'L1', sectionId: 'S1' }])
  const hit = await runTool('course.search', { query: 'currents at a node' }, { pageId: null })
  assert.equal(hit.ok, true)
  assert.match(hit.summary, /Kirchhoff/)
  assert.equal((await runTool('course.search', { query: 'quantum tunnelling' }, { pageId: null })).ok, false)
})
