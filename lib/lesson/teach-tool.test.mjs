// "teach me Ohm's law" → router → teach.lesson → a playing film, using the real
// authored lesson served by a stubbed /api/courses. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle } from '../../scripts/test/bundle.mjs'

const ohm = JSON.parse(readFileSync('content/courses/enex-101/ohms-law.json', 'utf8'))
globalThis.fetch = async (url) => {
  const u = String(url)
  const json = (b) => ({ ok: true, json: async () => b })
  if (u.includes('?lesson=')) return json({ lesson: { id: 'ohms-law', title: ohm.title, doc: ohm } })
  return json({ courses: [{ title: 'Basic Electrical Engineering', tree: [{ name: 'Fundamentals', lessons: [{ id: 'kcl', title: 'Kirchhoff laws' }, { id: 'ohms-law', title: "Ohm's Law and Resistance" }, { id: 'diode', title: 'Diodes' }], children: [] }] }] })
}

const m = await bundle(
  `
export { runTool } from '@/lib/tools/registry'
import '@/lib/tools/scene'
import '@/lib/tools/pages'
import '@/lib/tools/course-corpus'
import '@/lib/tools/lesson'
export { routeAct } from '@/lib/ai/tutor/router'
export { tryDirect } from '@/lib/ai/tutor/act'
export { useLesson } from '@/lib/lesson/store'
export { stopLesson } from '@/lib/lesson/controller'
export { useWorkspaceStore } from '@/lib/store/workspace'
export { useWalkthroughStore } from '@/lib/store/walkthrough-store'
export { setDirectorParts, cancelPreparing } from '@/lib/lesson/generate'
export { makeRunner } from '@/lib/lesson/runner'
export { useLessonCache } from '@/lib/lesson/cache'
`,
  'teach'
)
const { runTool, routeAct, tryDirect, useLesson, stopLesson, useWorkspaceStore, useWalkthroughStore, setDirectorParts, makeRunner, useLessonCache } = m

test('phrasings route straight to teach.lesson with a clean topic, no model', () => {
  const t = (p) => routeAct(p, false)
  assert.deepEqual(t('teach me ohms law'), { kind: 'direct', tool: 'teach.lesson', args: { topic: 'ohms law' } })
  assert.equal(t("Teach me about Ohm's law!").args.topic, "Ohm's law")
  assert.equal(t('give me a video lesson on diodes').args.topic, 'diodes')
  assert.equal(t('animate the diode rectifier with a video').args.topic, 'diode rectifier')
  assert.equal(t('walk me through Kirchhoff laws').tool, 'teach.lesson')
  assert.equal(t('explain ohms law'), null) // plain explain stays a written answer
  assert.equal(t('how fast is the ball?'), null)
})

test('teach.lesson finds the right lesson by wording, opens its own page and starts the film', async () => {
  const ws = useWorkspaceStore.getState()
  const nb = ws.addNotebook('NB'), sec = ws.addSection(nb, 'S'), page = ws.addPage(nb, sec, 'Mine')
  ws.setActivePage(page)
  useWalkthroughStore.setState({ muted: true, speed: 200 })
  const events = []
  const handled = await tryDirect({ prompt: 'teach me ohms law' }, { pageId: page }, (e) => events.push(e.event))
  assert.equal(handled, true)
  assert.deepEqual(events, ['intent', 'tool', 'done'])
  const L = useLesson.getState()
  assert.equal(L.active, true)
  assert.equal(L.storyboard.title, "Ohm's Law and Resistance")
  assert.notEqual(L.pageId, page, 'the student’s own page is left untouched')
  assert.match(useWorkspaceStore.getState().nodes[L.pageId].name, /^Lesson: Ohm/)
  stopLesson()
  assert.equal(useLesson.getState().active, false)
})

const CIRCUIT = `var bat = create("battery", { V: 9, name: "bat" });
var r1 = create("resistor", { R: 330, name: "r1" });
var am = create("ammeter", { name: "am" });
connect(bat.positive, am.a, "wire");
connect(am.b, r1.a, "wire");
connect(r1.b, bat.negative, "wire");`
const PLAN = { title: 'Series circuits', steps: [{ heading: 'One loop', say: ['Charge flows round one loop.'], scene: 'A 9 V battery across a 330 ohm resistor with an ammeter', experiment: 'double the resistance' }, { heading: 'Why', say: ['Same current everywhere.'] }] }

test('a topic with no authored lesson is generated in the background, played, cached, and replayed with no model', async () => {
  let modelCalls = 0
  setDirectorParts(() => ({
    runner: makeRunner(),
    llm: {
      async complete(system) { modelCalls++; return /choose ONE/.test(system) ? JSON.stringify({ object: 'r1', param: 'R', to: 660, watch_object: 'am', watch_channel: 'I' }) : JSON.stringify(PLAN) },
      async script() { modelCalls++; return CIRCUIT },
    },
  }))
  const ws = useWorkspaceStore.getState()
  const nb = ws.addNotebook('NB2'), sec = ws.addSection(nb, 'S'), page = ws.addPage(nb, sec, 'Mine')
  ws.setActivePage(page)
  useWalkthroughStore.setState({ muted: true, speed: 200 })

  const r = await runTool('teach.lesson', { topic: 'series circuits' }, { pageId: page })
  assert.equal(r.ok, true)
  assert.match(r.summary, /Building a lesson/)
  assert.ok(useLesson.getState().preparing, 'progress is visible while it builds')
  for (let i = 0; i < 200 && !useLesson.getState().active; i++) await new Promise((r) => setTimeout(r, 100))
  const L = useLesson.getState()
  assert.equal(L.active, true)
  assert.equal(L.preparing, null)
  assert.equal(L.storyboard.source, 'generated:series circuits')
  const p = L.storyboard.beats.find((b) => b.t === 'predict')
  assert.equal(p.choices[p.correct], 'It decreases.')
  assert.ok(useLessonCache.getState().get('series circuits', 'basic'))
  stopLesson()

  const before = modelCalls
  await runTool('teach.lesson', { topic: 'Series Circuits!' }, { pageId: page })
  for (let i = 0; i < 50 && !useLesson.getState().active; i++) await new Promise((r) => setTimeout(r, 100))
  assert.equal(useLesson.getState().active, true)
  assert.equal(modelCalls, before, 'the replay used the cache, not the model')
  stopLesson()
})
