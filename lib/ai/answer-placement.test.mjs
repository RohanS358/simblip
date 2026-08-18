// blocksToSimScript() output, run through the REAL executeSimScript() —
// catches a wiring bug the pure-function tests in answer-formatting.test.mjs
// can't see: how the answer's own script interacts with executeSimScript's
// "unplaced card" auto-layout (lib/scene/simscript.ts).
//
// That auto-layout treats x:0 AND y:0 TOGETHER as "never positioned" and is
// free to push the card down to dodge whatever's already on the page — a
// heuristic for scripts that genuinely never set a position. But every block
// blocksToSimScript() writes is deliberately positioned; it just happens
// that the layout starts both counters at 0. On a page that already has
// other content, the first block (the only one with y:0 too) was silently
// relocated out from under the caller's own centering math, dragging the
// whole answer column far off the point ai-panel.tsx just centered it on —
// found by driving the real app: an answer column that measured
// perfectly on-center on an empty page landed 400+px low on a busy one.
//
// Run: node --test lib/ai/answer-placement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-answer-placement-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'p.mjs')

writeFileSync(stub, `
let pages = { p: { objects: {} } }
export const useDocStore = {
  getState: () => ({
    pages,
    addObject(pageId, obj) { (pages[pageId] ??= { objects: {} }).objects[obj.id] = obj },
    updateObject(pageId, id, patch) {
      const cur = pages[pageId]?.objects?.[id]
      if (cur) pages[pageId].objects[id] = { ...cur, ...patch }
    },
    ensurePage() {},
    upsertVariable() {},
  }),
  setState: (fn) => { if (typeof fn === 'function') { const r = fn({ pages }); if (r?.pages) for (const k of Object.keys(r.pages)) pages[k] = r.pages[k] } },
  __reset: () => { pages = { p: { objects: {} } } },
  __seed: (obj) => { pages.p.objects[obj.id] = obj },
  __objects: () => Object.values(pages.p?.objects ?? {}),
}
`)
writeFileSync(entry, `
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { blocksToSimScript, answerColumnSize } from '@/lib/ai/explain'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`,
  '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe' })

const { executeSimScript, useDocStore, blocksToSimScript, answerColumnSize } = await import(bundle)

const blocks = [
  { kind: 'text', content: 'Impulse is a measure of the change in momentum of an object.' },
  { kind: 'formula', content: 'J = F \\Delta t' },
  { kind: 'text', content: 'It is used to analyse collisions and impacts.' },
]

test('an answer column on an EMPTY page lands exactly at the given origin', () => {
  useDocStore.__reset()
  const script = blocksToSimScript(blocks)
  const origin = { x: 300, y: 200 }
  executeSimScript('p', script, origin)
  const objs = useDocStore.__objects()
  const first = objs.reduce((a, b) => (a.position.y <= b.position.y ? a : b))
  assert.equal(first.position.x, origin.x + 1, 'the 1px nudge should be the only x offset')
  assert.equal(first.position.y, origin.y, 'first block must land exactly at the centered origin, not get relocated')
})

test('an answer column on a BUSY page still lands at the given origin, not pushed down', () => {
  useDocStore.__reset()
  // Seed the page with something already occupying the exact spot the new
  // answer is about to be centered on — the scenario that reproduced the bug:
  // a previous turn's scene sitting where the new answer needs to go.
  useDocStore.__seed({
    id: 'existing',
    name: 'existing',
    geometry: { kind: 'rect', points: [] },
    position: { x: 280, y: 180 },
    size: { w: 200, h: 150 },
    behaviors: [],
    parameters: {},
    metadata: {},
  })
  const script = blocksToSimScript(blocks)
  const origin = { x: 300, y: 200 }
  executeSimScript('p', script, origin)
  const objs = useDocStore.__objects().filter((o) => o.id !== 'existing')
  const first = objs.reduce((a, b) => (a.position.y <= b.position.y ? a : b))
  assert.equal(first.position.y, origin.y,
    `first block should stay at the centered origin (y=${origin.y}) even though the page has other content; got y=${first.position.y} — it was treated as "unplaced" and auto-relocated`)
})

test('answerColumnSize matches the total height blocksToSimScript actually lays out', () => {
  useDocStore.__reset()
  const script = blocksToSimScript(blocks)
  const origin = { x: 0, y: 0 }
  executeSimScript('p', script, origin)
  const objs = useDocStore.__objects()
  const top = Math.min(...objs.map((o) => o.position.y))
  const bottom = Math.max(...objs.map((o) => o.position.y + o.size.h))
  const size = answerColumnSize(blocks)
  assert.equal(bottom - top, size.h, 'answerColumnSize must predict the real laid-out height exactly, or centering is off by the difference')
})
