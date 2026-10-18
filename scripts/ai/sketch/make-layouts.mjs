// Lay random wave-1 circuits out with the app's OWN schematic engine, so the
// whole-circuit sketches have real part positions and real routed wires.
//
//   npm run sketch:layouts -- --seed 1 --n 400 --out data/sketch/scenes/layouts-s1.json
//
// For each random circuit (lib/sketch/random-circuit.ts): compile the Scene IR
// to SimScript (S0 compiler), run it through the real executeSimScript with a
// stub document store, and record every part's box, rotation and terminal
// positions plus every wire's polyline. scene-synth.ts then redraws that clean
// schematic as hand strokes. The IR is the ground truth.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileIR } from '../../../lib/sketch/compile.ts'
import { randomCircuit } from '../../../lib/sketch/random-circuit.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const seed = Number(arg('seed', 1))
const count = Number(arg('n', 400))
const out = resolve(arg('out', `data/sketch/scenes/layouts-s${seed}.json`))
const root = resolve(import.meta.dirname, '../../..')

// The app's runtime, bundled for Node with the document store stubbed (as in compile.test.mjs).
const dir = mkdtempSync(join(tmpdir(), 'sketch-layouts-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'sim.mjs')
writeFileSync(stub, `
let pages = { p: { objects: {} } }
export const useDocStore = {
  getState: () => ({
    pages,
    addObject(pageId, obj) { (pages[pageId] ??= { objects: {} }).objects[obj.id] = obj },
    updateObject(pageId, id, patch) { const cur = pages[pageId]?.objects?.[id]; if (cur) pages[pageId].objects[id] = { ...cur, ...patch } },
    ensurePage() {}, upsertVariable() {},
  }),
  setState: (fn) => { if (typeof fn === 'function') { const r = fn({ pages }); if (r?.pages) for (const k of Object.keys(r.pages)) pages[k] = r.pages[k] } },
  __reset: () => { pages = { p: { objects: {} } } },
  __objects: () => Object.values(pages.p?.objects ?? {}),
}
`)
writeFileSync(entry, `
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`, '--external:react', '--external:zustand'],
  { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
const { executeSimScript, useDocStore, terminalsOf, terminalWorld } = await import(pathToFileURL(bundle).href)

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const rng = makeRng(seed)
const layouts = []
let skipped = 0

for (let i = 0; i < count; i++) {
  const ir = randomCircuit(rng.fork(`c${i}`))
  const res = compileIR(ir, { plot: false })
  if (!res.ok) { skipped++; continue }

  useDocStore.__reset()
  try {
    executeSimScript('p', res.script, { x: 200, y: 100 }, { bounds: { left: 0, top: 0, right: 1400, bottom: 900 }, fixedFrame: false })
  } catch { skipped++; continue }
  const objects = useDocStore.__objects()
  const symbols = objects.filter((o) => o.geometry.kind === 'symbol')
  if (symbols.length !== ir.nodes.length) { skipped++; continue }

  // IR node -> scene object: the k-th node of a kind is the k-th symbol of that kind.
  const used = {}
  const parts = ir.nodes.map((n) => {
    const k = (used[n.cls] = (used[n.cls] ?? -1) + 1)
    const o = symbols.filter((s) => s.geometry.symbol === n.cls)[k]
    return {
      id: n.id, cls: n.cls,
      x: o.position.x, y: o.position.y, w: o.size.w, h: o.size.h, rot: o.rotation ?? 0,
      terminals: terminalsOf(o).map((t) => terminalWorld(o, t)),
    }
  })

  // Each routed wire ends on two terminals: find which.
  const attach = (pt) => {
    let best = null
    parts.forEach((p, pi) => p.terminals.forEach((t, ti) => { const d = near(pt, t); if (d < 3 && (!best || d < best.d)) best = { part: pi, term: ti, d } }))
    return best
  }
  const wires = objects.filter((o) => o.geometry.kind === 'line').map((o) => {
    const pts = (o.geometry.points ?? []).map(([x, y]) => ({ x: x + o.position.x, y: y + o.position.y }))
    return { pts, a: attach(pts[0]), b: attach(pts[pts.length - 1]) }
  })
  if (wires.length !== ir.edges.length || wires.some((w) => !w.a || !w.b || w.pts.length < 2)) { skipped++; continue }

  layouts.push({
    id: `s${seed}-c${i}`,
    ir,
    parts,
    wires: wires.map((w) => ({ pts: w.pts.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]), a: { part: w.a.part, term: w.a.term }, b: { part: w.b.part, term: w.b.term } })),
  })
}

rmSync(dir, { recursive: true, force: true })
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ seed, count: layouts.length, skipped, layouts }))
console.log(`laid out ${layouts.length} circuits (${skipped} skipped) -> ${out}`)
