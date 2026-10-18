// End to end, in the real runtime: a hand-drawn circuit (generated hands) →
// whole-circuit reader → the preview's state → compiled SimScript → the app's own
// executeSimScript → the circuit engine. Run: node --test lib/sketch/sketch-to-circuit.test.mjs
//
// What this proves: the pieces that were unit-tested separately fit together,
// and that a circuit read exactly BEHAVES like the circuit that was drawn when
// both run in the engine. What it does not prove: anything about real
// handwriting (every sketch here is generated).

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'sketch-e2e-'))
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
export { drawScene } from '@/lib/sketch/scene-synth'
export { makeWriter } from '@/lib/sketch/synth'
export { makeRng } from '@/lib/sketch/rng'
export { createSketchNet } from '@/lib/sketch/sketchnet'
export { startCircuitGhost, editPart, compileGhost, inkToReplace, inkOrigin, examplesFrom, toCheck, setKeepLayout } from '@/lib/sketch/circuit-ghost'
export { compareIR } from '@/lib/sketch/compare-ir'
export { compileIR } from '@/lib/sketch/compile'
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { buildCircuit, stepCircuit } from '@/lib/circuit/engine'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`, '--external:react', '--external:zustand'],
  { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
const m = await import(pathToFileURL(bundle).href)
test.after(() => rmSync(dir, { recursive: true, force: true }))

const manifest = JSON.parse(readFileSync(resolve(root, 'public/models/sketchnet-v1.json'), 'utf8'))
const bin = readFileSync(resolve(root, 'public/models/sketchnet-v1.bin'))
const net = m.createSketchNet(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength))
const { layouts } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden/scene-layouts.json'), 'utf8'))

const BOUNDS = { left: 0, top: 0, right: 1400, bottom: 900 }

/** Draw layout `i` with a fresh mouse writer and read it back. */
function sketch(i, seed = 1) {
  const rng = m.makeRng(100 * seed + i)
  const writer = m.makeWriter(rng.fork('w'), `e2e-${seed}-${i}`, 'mouse')
  const scene = m.drawScene(layouts[i], rng.fork('s'), writer)
  const ink = scene.strokes.map((pts, k) => ({ id: `k${k}`, pts }))
  return { scene, ink, ghost: m.startCircuitGhost('p', ink, net) }
}

/** Run a compiled script in the real runtime and solve it. */
function run(script, steps = 150) {
  m.useDocStore.__reset()
  m.executeSimScript('p', script, { x: 200, y: 100 }, { bounds: BOUNDS, fixedFrame: false })
  const objects = m.useDocStore.__objects()
  const byId = Object.fromEntries(objects.map((o) => [o.id, o]))
  const circuit = m.buildCircuit(objects)
  for (let i = 0; circuit && i < steps; i++) m.stepCircuit(circuit, 0.001, i * 0.001, byId)
  return { objects, circuit }
}

test('a hand-drawn circuit becomes a live circuit: compile, run, and every part and wire is there', () => {
  let built = 0
  let tried = 0
  for (let i = 0; i < layouts.length; i++) {
    const { ghost } = sketch(i)
    if (!ghost) continue
    tried++
    const res = m.compileGhost(ghost)
    if (!res.ok) continue // a misread can be un-compilable; the preview shows the error and lets the person fix it
    const { objects, circuit } = run(res.script)
    const symbols = objects.filter((o) => o.geometry.kind === 'symbol')
    const wires = objects.filter((o) => o.geometry.kind === 'line')
    assert.equal(symbols.length, ghost.result.parts.length, `circuit ${i}: one scene part per recognised part`)
    assert.equal(wires.length, ghost.result.ir.edges.length, `circuit ${i}: one wire per connection`)
    assert.ok(circuit, `circuit ${i}: the engine built a netlist`)
    for (const o of objects) {
      assert.ok(o.position.x >= -50 && o.position.x <= BOUNDS.right + 50 && o.position.y >= -50 && o.position.y <= BOUNDS.bottom + 50, `circuit ${i}: ${o.name} is placed on the page`)
    }
    for (const r of circuit.frame.readings.values()) for (const v of Object.values(r.channels ?? {})) assert.ok(Number.isFinite(v), `circuit ${i}: finite readings`)
    built++
  }
  assert.ok(tried >= 14, `read ${tried} of ${layouts.length}`)
  assert.ok(built >= 0.8 * tried, `only ${built}/${tried} circuits compiled and ran`)
})

test('behavioural equivalence: a circuit read exactly behaves like the one that was drawn', () => {
  let checked = 0
  for (let i = 0; i < layouts.length; i++) {
    for (const seed of [1, 2, 3]) {
      const { scene, ghost } = sketch(i, seed)
      if (!ghost) continue
      const cmp = m.compareIR(ghost.result.ir, scene.truth)
      if (!cmp.exact) continue
      // Same parts, same wiring. The person would type the values; copy the true ones across.
      const center = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2]
      let g = ghost
      for (const t of scene.truth.nodes) {
        if (!t.values) continue
        const tc = center(t.bbox)
        const p = g.result.ir.nodes.filter((n) => n.cls === t.cls).sort((a, b) => Math.hypot(...center(a.bbox).map((v, k) => v - tc[k])) - Math.hypot(...center(b.bbox).map((v, k) => v - tc[k])))[0]
        for (const [k, v] of Object.entries(t.values)) {
          if (k === 'f') continue // only the main parameter is editable in the preview
          g = m.editPart(g, p.id, { value: v })
        }
      }
      // (the preview edits only a part's main value, so the AC frequency is left at its default on both sides)
      const noFreq = { ...scene.truth, doubts: [], nodes: scene.truth.nodes.map((n) => (n.values && 'f' in n.values ? { ...n, values: Object.fromEntries(Object.entries(n.values).filter(([k]) => k !== 'f')) } : n)) }
      const drawn = m.compileIR(noFreq, { plot: false })
      const read = m.compileGhost(g)
      if (!drawn.ok || !read.ok) continue
      const a = run(drawn.script)
      const b = run(read.script)
      // A part whose two ends are interchangeable can be read either way round, which
      // flips the SIGN of its voltage reading and nothing else: compare its magnitude.
      const SYMMETRIC = new Set(['resistor', 'capacitor', 'inductor', 'switch', 'bulb', 'voltmeter', 'ammeter', 'ac-source'])
      const sig = (r) => r.objects
        .filter((o) => o.geometry.kind === 'symbol')
        .map((o) => {
          const sym = o.geometry.symbol
          const ch = r.circuit.frame.readings.get(o.id)?.channels ?? {}
          return { sym, V: SYMMETRIC.has(sym) ? Math.abs(ch.V ?? 0) : ch.V ?? 0, I: Math.abs(ch.I ?? 0) }
        })
        .sort((x, y) => (x.sym < y.sym ? -1 : x.sym > y.sym ? 1 : Math.abs(x.V) - Math.abs(y.V) || x.I - y.I))
      const close = (x, y) => Math.abs(x - y) <= 1e-6 * Math.max(Math.abs(x), Math.abs(y)) + 1e-9
      const sa = sig(a)
      const sb = sig(b)
      assert.equal(sb.length, sa.length)
      sa.forEach((x, k) => {
        assert.equal(sb[k].sym, x.sym, `circuit ${i} seed ${seed}: part ${k}`)
        assert.ok(close(sb[k].V, x.V) && close(sb[k].I, x.I), `circuit ${i} seed ${seed}: ${x.sym} reads V=${sb[k].V} I=${sb[k].I}, drawn circuit V=${x.V} I=${x.I}`)
      })
      checked++
    }
  }
  assert.ok(checked >= 8, `only ${checked} exactly-read circuits were available to compare`)
})

test('editing a part re-reads the wiring: turning a diode swaps which end is the anode', () => {
  for (let i = 0; i < layouts.length; i++) {
    const { ghost } = sketch(i)
    const d = ghost?.result.parts.find((p) => p.cls === 'diode' || p.cls === 'led')
    if (!d) continue
    // which of the diode's pins goes to which other pin
    const edgesOf = (g) => g.result.ir.edges
      .filter((e) => e.a.node === d.id || e.b.node === d.id)
      .map((e) => (e.a.node === d.id ? `${e.a.pin}->${e.b.node}.${e.b.pin}` : `${e.b.pin}->${e.a.node}.${e.a.pin}`))
      .sort()
    const before = edgesOf(ghost)
    const after = edgesOf(m.editPart(m.editPart(ghost, d.id, { pose: (d.pose + 180) % 360 }), d.id, {}))
    assert.equal(before.length, after.length, 'same number of connections')
    assert.notDeepEqual(before, after, 'the two ends trade places')
    return
  }
  assert.fail('no diode found in the fixtures')
})

test('a typed value reaches the compiled script; a class correction clears the old value', () => {
  for (let i = 0; i < layouts.length; i++) {
    const { ghost } = sketch(i)
    const r = ghost?.result.parts.find((p) => p.cls === 'resistor')
    if (!r) continue
    const typed = m.editPart(ghost, r.id, { value: '4.7k' })
    assert.match(m.compileGhost(typed).script, /create\("resistor", \{ R: 4700 \}\)/)
    const changed = m.editPart(typed, r.id, { cls: 'capacitor' })
    const part = changed.result.parts.find((p) => p.id === r.id)
    assert.equal(part.cls, 'capacitor')
    assert.equal(part.values, undefined, 'the resistor value does not leak onto a capacitor')
    assert.equal(part.conf, 1, 'a class the person chose is no longer a guess')
    return
  }
  assert.fail('no resistor found in the fixtures')
})

test('"Keep my layout" places parts where they were drawn', () => {
  const { ghost } = sketch(0)
  const kept = m.compileGhost(m.setKeepLayout(ghost, true))
  assert.ok(kept.ok, JSON.stringify(kept.errors))
  assert.match(kept.script, /x: \d+, y: \d+/)
  assert.doesNotMatch(m.compileGhost(ghost).script, /\bx: \d/)
})

test('the ink to replace is exactly the circuit: parts, wires and dots — nothing else', () => {
  const { ink, ghost } = sketch(1)
  const extra = { id: 'stray', pts: [[2000, 2000], [2010, 2000], [2020, 2010]] }
  const g = m.startCircuitGhost('p', [...ink, extra], net)
  const ids = new Set(m.inkToReplace(g))
  assert.ok(!ids.has('stray'), 'unread ink is left alone')
  for (const id of m.inkToReplace(ghost)) assert.ok(ink.some((s) => s.id === id))
  const o = m.inkOrigin(ghost)
  assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y))
})

test('every confirmed part is kept as a real example, local-only', () => {
  const { ghost } = sketch(2)
  const rows = m.examplesFrom(ghost, 'anon-test')
  assert.equal(rows.length, ghost.result.parts.length)
  for (const r of rows) {
    assert.equal(r.source, 'real')
    assert.equal(r.meta.storage, 'local-only')
    assert.equal(r.writer, 'anon-test')
  }
  const fixed = m.editPart(ghost, ghost.result.parts[0].id, { cls: 'gnd' })
  const row = m.examplesFrom(fixed, 'anon-test')[0]
  assert.equal(row.cls, 'gnd')
  assert.equal(row.meta.changed, true)
})

test('an empty or unreadable selection gives no preview rather than a broken one', () => {
  assert.equal(m.startCircuitGhost('p', [], net), null)
  assert.equal(m.startCircuitGhost('p', [{ id: 'a', pts: [[0, 0], [1, 1]] }], net), null)
})
