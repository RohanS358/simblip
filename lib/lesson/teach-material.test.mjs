// A photographed question dropped in the chat → OCR text in the fenced prompt → router → teach.material → a worked,
// drawn, narrated lesson on its own page. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

globalThis.fetch = async () => ({ ok: true, json: async () => ({ courses: [] }) })
const m = await bundle(`
export { runTool } from '@/lib/tools/registry'
import '@/lib/tools/scene'
import '@/lib/tools/pages'
import '@/lib/tools/teach-material'
export { tryDirect } from '@/lib/ai/tutor/act'
export { withAttachments } from '@/lib/ai/attachments'
export { useLesson } from '@/lib/lesson/store'
export { stopLesson } from '@/lib/lesson/controller'
export { useWorkspaceStore } from '@/lib/store/workspace'
export { useWalkthroughStore } from '@/lib/store/walkthrough-store'
export { setDirectorParts, cancelPreparing } from '@/lib/lesson/generate'
export { makeRunner } from '@/lib/lesson/runner'
`, 'teach-material')
const { tryDirect, withAttachments, useLesson, stopLesson, useWorkspaceStore, useWalkthroughStore, setDirectorParts, makeRunner, cancelPreparing } = m

const Q = 'Q3. A 12 V battery drives a current through a 4 ohm resistor. Find the current.'
const CIRCUIT = `var bat = create("battery", { V: 12, name: "bat" });
var r1 = create("resistor", { R: 4, name: "r1" });
var am = create("ammeter", { name: "am" });
connect(bat.positive, am.a, "wire");
connect(am.b, r1.a, "wire");
connect(r1.b, bat.negative, "wire");`
// The model gets the arithmetic WRONG on purpose: the teacher must correct it, not repeat it.
const SOLUTION = { title: 'Current in a resistor', steps: [
  { heading: 'What we are given', say: ['A 12 volt battery is across a 4 ohm resistor.', 'We are asked for the current.'], scene: 'a 12 V battery across a 4 ohm resistor with an ammeter' },
  { heading: 'Apply Ohm law', say: ['Ohm law links voltage, current and resistance.', 'So the current is the voltage divided by the resistance.'], equation: 'I = \\frac{V}{R} = \\frac{12}{4} = 4' },
  { heading: 'The answer', say: ['The current is about three amps.'] },
] }

test('a screenshot question is solved: drawn, worked, the wrong arithmetic corrected, on its own page', async () => {
  const seen = []
  setDirectorParts(() => ({ runner: makeRunner(), llm: {
    async complete(system, user) { seen.push({ system, user }); return JSON.stringify(SOLUTION) },
    async script() { return CIRCUIT },
  } }))
  const ws = useWorkspaceStore.getState()
  const nb = ws.addNotebook('NB'), sec = ws.addSection(nb, 'S'), page = ws.addPage(nb, sec, 'Mine')
  ws.setActivePage(page)
  useWalkthroughStore.setState({ muted: true, speed: 200 })

  const prompt = withAttachments('solve this', [{ name: 'q.png', text: Q }])
  const events = []
  assert.equal(await tryDirect({ prompt }, { pageId: page }, (e) => events.push(e)), true)
  assert.equal(events.find((e) => e.event === 'tool').data.name, 'teach.material')
  for (let i = 0; i < 200 && !useLesson.getState().active; i++) await new Promise((r) => setTimeout(r, 100))
  const L = useLesson.getState()
  assert.equal(L.active, true)
  assert.notEqual(L.pageId, page, 'the student’s own page is left untouched')
  assert.match(seen[0].user, /12 V battery drives/, 'the question read from the picture is what the model was given')
  assert.match(seen[0].system, /solving a problem/i)
  const eq = L.storyboard.beats.find((b) => b.t === 'equation')
  assert.match(eq.latex, /= 3$/, '12 / 4 is 3 — the model said 4 and was corrected')
  assert.ok(L.storyboard.beats.some((b) => b.t === 'say' && /corrected/i.test(b.text)), 'the correction is said out loud')
  assert.ok(L.storyboard.beats.some((b) => b.t === 'scene'), 'the situation is drawn')
  stopLesson()
  cancelPreparing()
})

test('"to the point" gets the short prompt; nothing is asked of the model for an unreadable file', async () => {
  const prompts = []
  setDirectorParts(() => ({ runner: makeRunner(), llm: { async complete(system) { prompts.push(system); return JSON.stringify({ title: 'Unclear', unsure: 'Which part of the circuit do you mean?', steps: [] }) }, async script() { return '' } } }))
  const ws = useWorkspaceStore.getState()
  const nb = ws.addNotebook('NB5'), sec = ws.addSection(nb, 'S'), page = ws.addPage(nb, sec, 'Mine')
  ws.setActivePage(page)
  stopLesson()
  await tryDirect({ prompt: withAttachments('solve this briefly', [{ name: 'q.png', text: Q }]) }, { pageId: page }, () => {})
  await new Promise((r) => setTimeout(r, 400))
  assert.match(prompts[0], /4 to 6 steps, 1 or 2 sentences/)
  assert.equal(useLesson.getState().active, false, 'a model that asks a question does not start a lesson')
  cancelPreparing()
})
