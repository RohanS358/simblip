// Phase S0 exit tests for the Scene IR compiler.
// Run: node --test lib/sketch/compile.test.mjs
//
//   1. Every gold IR (scripts/ai/sketch/gold/*.json) compiles, lints clean,
//      builds a scene through the REAL executeSimScript, solves in the REAL
//      circuit engine, and meets its numeric expectations. Compile < 20 ms.
//   2. Wrong IR (missing pin, unknown class, …) produces a clear error and
//      never throws.
//   3. The compiler's small judgement calls — unit parsing, the 9 V default,
//      label values, layout modes — are pinned down.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const goldDir = join(root, 'scripts/ai/sketch/gold')
const dir = mkdtempSync(join(tmpdir(), 'sketch-compile-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'sim.mjs')

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
  __objects: () => Object.values(pages.p?.objects ?? {}),
}
`)
writeFileSync(entry, `
export { compileIR, parseQuantity } from '@/lib/sketch/compile'
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { buildCircuit, stepCircuit } from '@/lib/circuit/engine'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`,
  '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })

const { compileIR, parseQuantity, executeSimScript, useDocStore, buildCircuit, stepCircuit } = await import(pathToFileURL(bundle).href)
test.after(() => rmSync(dir, { recursive: true, force: true }))

// ── helpers ────────────────────────────────────────────────────────────────

const node = (id, cls, extra = {}) => ({ id, cls, conf: 1, bbox: [0, 0, 60, 30], rot: 0, source: 'ink', ...extra })
const edge = (a, b, extra = {}) => {
  const p = (s) => ({ node: s.slice(0, s.indexOf('.')), pin: s.slice(s.indexOf('.') + 1) })
  return { a: p(a), b: p(b), kind: 'wire', conf: 1, ...extra }
}
const ir = (nodes, edges, extra = {}) => ({ domain: 'circuit', nodes, edges, labels: [], doubts: [], ...extra })

/** The smallest valid circuit. */
const loop = () => ir(
  [node('b', 'battery', { values: { V: '5' } }), node('r', 'resistor', { values: { R: '1k' } })],
  [edge('b.positive', 'r.a'), edge('r.b', 'b.negative')],
)

/** Run a compiled script in the real runtime and solve it in the real engine. */
function simulate(script, steps = 200, dt = 0.001) {
  useDocStore.__reset()
  executeSimScript('p', script, { x: 200, y: 100 }, {
    bounds: { left: 0, top: 0, right: 1400, bottom: 900 }, fixedFrame: false,
  })
  const objects = useDocStore.__objects()
  const byId = Object.fromEntries(objects.map((o) => [o.id, o]))
  const circuit = buildCircuit(objects)
  assert.ok(circuit, 'engine built a circuit from the scene')
  for (let i = 0; i < steps; i++) stepCircuit(circuit, dt, i * dt, byId)
  return { objects, circuit }
}

/** IR node → scene object: k-th node of a kind ↔ k-th symbol of that kind. */
function objectsByNode(irDoc, objects) {
  const symbols = objects.filter((o) => o.geometry.kind === 'symbol')
  const used = {}
  const out = {}
  for (const n of irDoc.nodes) {
    const kind = n.cls.toLowerCase()
    const k = used[kind] = (used[kind] ?? -1) + 1
    out[n.id] = symbols.filter((o) => o.geometry.symbol === kind)[k]
  }
  return out
}

// ── 1. gold set ────────────────────────────────────────────────────────────

const goldFiles = readdirSync(goldDir).filter((f) => f.endsWith('.json')).sort()

test('there are at least 40 gold IR files', () => {
  assert.ok(goldFiles.length >= 40, `found ${goldFiles.length}`)
})

for (const file of goldFiles) {
  const gold = JSON.parse(readFileSync(join(goldDir, file), 'utf8'))

  test(`gold: ${gold.name} compiles, lints, simulates`, () => {
    compileIR(gold.ir) // warm the JIT so the timing below is the steady state
    const t0 = performance.now()
    const res = compileIR(gold.ir)
    const ms = performance.now() - t0
    assert.equal(res.ok, true, JSON.stringify(res.errors))
    assert.deepEqual(res.errors, [])
    assert.ok(ms < 20, `compile took ${ms.toFixed(1)} ms`)

    const { objects, circuit } = simulate(res.script)
    const symbols = objects.filter((o) => o.geometry.kind === 'symbol')
    assert.equal(symbols.length, gold.ir.nodes.length, 'one scene part per IR node')
    const wires = objects.filter((o) => o.geometry.kind === 'line')
    assert.equal(wires.length, gold.ir.edges.length, 'one drawn wire per IR edge')

    const parts = objectsByNode(gold.ir, objects)
    for (const [id, o] of Object.entries(parts)) {
      const r = circuit.frame.readings.get(o.id)
      for (const [ch, v] of Object.entries(r?.channels ?? {})) {
        assert.ok(Number.isFinite(v), `${id}.${ch} is finite`)
      }
    }
    for (const e of gold.expect) {
      const o = parts[e.part]
      const got = circuit.frame.readings.get(o.id)?.channels?.[e.channel]
      assert.ok(got !== undefined, `${e.part} publishes ${e.channel}`)
      const mag = Math.abs(got)
      if (e.min !== undefined) assert.ok(mag >= e.min, `${e.part}.${e.channel} = ${mag}, want ≥ ${e.min}`)
      if (e.max !== undefined) assert.ok(mag <= e.max, `${e.part}.${e.channel} = ${mag}, want ≤ ${e.max}`)
      if (e.value !== undefined) {
        const tol = e.abs !== undefined ? e.abs : Math.abs(e.value) * (e.tol ?? 0.05)
        assert.ok(Math.abs(mag - Math.abs(e.value)) <= tol, `${e.part}.${e.channel} = ${mag}, want ${e.value} ± ${tol}`)
      }
    }
  })
}

// ── 2. wrong IR is an error, never a crash ─────────────────────────────────

const errorCodes = (doc) => compileIR(doc).errors.map((e) => e.code)

test('unknown class', () => {
  const doc = loop()
  doc.nodes[1].cls = 'flux-capacitor'
  const res = compileIR(doc)
  assert.equal(res.ok, false)
  assert.equal(res.script, '')
  assert.match(res.errors[0].message, /flux-capacitor/)
  assert.equal(res.errors[0].code, 'unknown-class')
})

test('a wire, junction or text is not a component', () => {
  for (const cls of ['wire', 'junction', 'text', 'unknown']) {
    const doc = loop()
    doc.nodes[1].cls = cls
    assert.ok(errorCodes(doc).includes('not-a-component'), cls)
  }
})

test('missing pin: a resistor has no collector', () => {
  const doc = loop()
  doc.edges[0] = edge('b.positive', 'r.collector')
  const res = compileIR(doc)
  assert.equal(res.ok, false)
  assert.equal(res.errors[0].code, 'bad-pin')
  assert.match(res.errors[0].message, /collector/)
})

test('edge to a node that does not exist', () => {
  const doc = loop()
  doc.edges.push(edge('b.positive', 'ghost.a'))
  assert.ok(errorCodes(doc).includes('unknown-node'))
})

test('duplicate node ids', () => {
  const doc = loop()
  doc.nodes.push(node('r', 'resistor'))
  assert.ok(errorCodes(doc).includes('duplicate-node'))
})

test('a wire from a pin to itself', () => {
  const doc = loop()
  doc.edges.push(edge('r.a', 'r.a'))
  assert.ok(errorCodes(doc).includes('self-loop'))
})

test('rope/spring edges are not valid in a circuit', () => {
  const doc = loop()
  doc.edges[0] = edge('b.positive', 'r.a', { kind: 'spring' })
  assert.ok(errorCodes(doc).includes('bad-edge-kind'))
})

test('a parameter the part does not have', () => {
  const doc = loop()
  doc.nodes[1].values = { Q: '3' }
  const res = compileIR(doc)
  assert.equal(res.ok, false)
  assert.equal(res.errors[0].code, 'unknown-param')
  assert.match(res.errors[0].message, /takes R/)
})

test('optics is reported as not compiled yet, not mis-compiled', () => {
  const res = compileIR(ir([node('m', 'thin-lens')], [], { domain: 'optics' }))
  assert.equal(res.ok, false)
  assert.equal(res.errors[0].code, 'unsupported-domain')
})

test('mechanics compiles: a mass alone is a valid (if dull) scene', () => {
  const res = compileIR(ir([node('m', 'mass')], [], { domain: 'mechanics' }))
  assert.equal(res.ok, true, JSON.stringify(res.errors))
  assert.match(res.script, /create\("mass"/)
})

test('garbage input never throws', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { domain: 'circuit' }, { domain: 'circuit', nodes: 'no' }, []]) {
    const res = compileIR(bad)
    assert.equal(res.ok, false)
    assert.equal(res.errors[0].code, 'schema')
  }
})

test('errors are collected, not just the first', () => {
  const doc = loop()
  doc.nodes[1].cls = 'nope'
  doc.edges.push(edge('b.positive', 'ghost.a'))
  assert.ok(compileIR(doc).errors.length >= 2)
})

// ── 3. judgement calls ─────────────────────────────────────────────────────

test('parseQuantity reads units the way students write them', () => {
  const cases = [
    ['10k', 10000, ''], ['4.7 kΩ', 4700, 'Ω'], ['100n', 1e-7, ''], ['1M', 1e6, ''], ['1meg', 1e6, ''],
    ['9V', 9, 'V'], ['2.2uF', 2.2e-6, 'F'], ['2.2µF', 2.2e-6, 'F'], ['10mH', 0.01, 'H'], ['5', 5, ''],
    ['5 mA', 0.005, 'A'], ['330 ohm', 330, 'Ω'], ['1e3', 1000, ''], ['.5', 0.5, ''], ['50Hz', 50, 'Hz'],
  ]
  for (const [text, value, unit] of cases) {
    const q = parseQuantity(text)
    assert.ok(q, `"${text}" parses`)
    assert.ok(Math.abs(q.value - value) <= Math.abs(value) * 1e-9, `"${text}" → ${q.value}, want ${value}`)
    assert.equal(q.unit, unit, `"${text}" unit`)
  }
  for (const bad of ['', 'abc', '1k2x', '--3', '10 kk']) assert.equal(parseQuantity(bad), null, `"${bad}" is unreadable`)
})

test('compiled output is exactly the plan\'s example', () => {
  const res = compileIR(ir(
    [node('n1', 'battery', { values: { V: '9' } }), node('n2', 'resistor', { values: { R: '1k' } }), node('n3', 'diode')],
    [edge('n1.positive', 'n2.a'), edge('n2.b', 'n3.anode'), edge('n3.cathode', 'n1.negative')],
  ))
  assert.equal(res.script, [
    'var battery1 = create("battery", { V: 9 });',
    'var resistor1 = create("resistor", { R: 1000 });',
    'var diode1 = create("diode", {});',
    'connect(battery1.positive, resistor1.a);',
    'connect(resistor1.b, diode1.anode);',
    'connect(diode1.cathode, battery1.negative);',
    'graph.plot(resistor1.I);',
  ].join('\n'))
})

test('compilation is deterministic', () => {
  const gold = JSON.parse(readFileSync(join(goldDir, 'series-parallel.json'), 'utf8'))
  assert.equal(compileIR(gold.ir).script, compileIR(gold.ir).script)
})

test('a battery with no voltage gets 9 V and a doubt, never silently', () => {
  const doc = ir([node('b', 'battery'), node('r', 'resistor')], [edge('b.positive', 'r.a'), edge('r.b', 'b.negative')])
  const res = compileIR(doc)
  assert.equal(res.ok, true)
  assert.match(res.script, /create\("battery", \{ V: 9 \}\)/)
  assert.deepEqual(res.doubts.filter((d) => d.ref === 'b'), [{ ref: 'b', why: 'unreadable-value' }])
  assert.ok(res.warnings.some((w) => /defaulted to 9 V/.test(w)))
})

test('an unreadable value is dropped with a doubt, not a failure', () => {
  const doc = loop()
  doc.nodes[1].values = { R: 'lk?' }
  const res = compileIR(doc)
  assert.equal(res.ok, true)
  assert.ok(res.doubts.some((d) => d.ref === 'r' && d.why === 'unreadable-value'))
  assert.match(res.script, /create\("resistor", \{\}\)/)
})

test('a value written beside a part fills in when the part has none', () => {
  const doc = loop()
  delete doc.nodes[1].values
  doc.labels = [{ text: '4.7k', bbox: [0, 0, 10, 10], attachedTo: 'r' }]
  assert.match(compileIR(doc).script, /create\("resistor", \{ R: 4700 \}\)/)
})

test('a label whose unit disagrees with the part is ignored', () => {
  const doc = loop()
  delete doc.nodes[1].values
  doc.labels = [{ text: '9V', bbox: [0, 0, 10, 10], attachedTo: 'r' }]
  assert.match(compileIR(doc).script, /create\("resistor", \{\}\)/)
})

test('low-confidence parts and wires are surfaced as doubts', () => {
  const doc = loop()
  doc.nodes[1].conf = 0.4
  doc.edges[0].conf = 0.5
  const res = compileIR(doc)
  assert.ok(res.doubts.some((d) => d.ref === 'r' && d.why === 'low-confidence'))
  assert.ok(res.doubts.some((d) => d.why === 'ambiguous-junction'))
})

test('IR doubts pass through, without duplicates', () => {
  const doc = loop()
  doc.doubts = [{ ref: 'r', why: 'low-confidence' }]
  doc.nodes[1].conf = 0.1
  assert.equal(compileIR(doc).doubts.filter((d) => d.ref === 'r').length, 1)
})

test('op-amp pins written "in+" / "in-" compile to valid anchors', () => {
  const doc = ir(
    [node('v', 'battery', { values: { V: '3' } }), node('o', 'opamp'), node('r', 'resistor')],
    [edge('v.positive', 'o.in+'), edge('o.out', 'o.in-'), edge('o.out', 'r.a'), edge('r.b', 'v.negative')],
  )
  const res = compileIR(doc)
  assert.equal(res.ok, true, JSON.stringify(res.errors))
  assert.match(res.script, /opamp1\.inp/)
  assert.match(res.script, /opamp1\.inn/)
})

test('a duplicate wire is ignored with a warning', () => {
  const doc = loop()
  doc.edges.push(edge('r.a', 'b.positive'))
  const res = compileIR(doc)
  assert.equal(res.ok, true)
  assert.equal(res.script.split('connect(').length - 1, 2)
  assert.ok(res.warnings.some((w) => /duplicate wire/.test(w)))
})

test('layout "auto" emits no coordinates; "keep" places by bbox with pose', () => {
  const doc = loop()
  doc.nodes[0].bbox = [100, 50, 30, 60]
  doc.nodes[1].bbox = [220, 50, 60, 24]
  doc.nodes[1].rot = 90
  assert.doesNotMatch(compileIR(doc).script, /\bx:/)
  const kept = compileIR(doc, { layout: 'keep' })
  assert.equal(kept.ok, true)
  assert.match(kept.script, /create\("battery", \{ V: 5, x: 10, y: 10 \}\)/)
  assert.match(kept.script, /create\("resistor", \{ R: 1000, x: 130, y: 10, rotation: 90 \}\)/)
})

test('plot can be switched off', () => {
  assert.doesNotMatch(compileIR(loop(), { plot: false }).script, /graph\.plot/)
  assert.match(compileIR(loop()).script, /graph\.plot\(resistor1\.I\)/)
})

test('an empty sketch compiles to an empty script, not an error', () => {
  const res = compileIR(ir([], []))
  assert.equal(res.ok, true)
  assert.equal(res.script, '')
})
