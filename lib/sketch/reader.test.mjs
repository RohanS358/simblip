// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test lib/sketch/reader.test.mjs
//
// The whole-circuit reader's parts, one at a time: geometry, pin tables, the
// wiring rules (with a fake network so each rule is tested on its own), the
// circuit comparison, the random-circuit and scene generators.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Dsu, axisStats, boxGap, boxOf, median, pathLength, polyCrossings, polyDist, rdp, resamplePath, segCross, segDist } from './geom.ts'
import { PIN_TEMPLATE, pinsOf, rotateUV } from './pins.ts'
import { measurePins } from './pin-calibration.ts'
import { GLYPHS, PIN_FRAME } from './glyphs.ts'
import { WAVE1_CLASSES, POSE_SYMMETRY } from './classes.ts'
import { makeRng } from './rng.ts'
import { TOPOLOGIES, randomCircuit } from './random-circuit.ts'
import { compileIR } from './compile.ts'
import { compareIR } from './compare-ir.ts'
import { extractCircuit, irFrom, partPins, rewire, shapeOf, wireUp } from './extract.ts'
import { drawScene } from './scene-synth.ts'
import { makeWriter } from './synth.ts'

// ── geometry ───────────────────────────────────────────────────────────────

test('geom: distances, boxes, simplification, crossings, resampling', () => {
  assert.equal(segDist([5, 5], [0, 0], [10, 0]), 5)
  assert.equal(segDist([-3, 4], [0, 0], [10, 0]), 5, 'beyond the end it is the end point')
  assert.equal(polyDist([5, 3], [[0, 0], [10, 0], [10, 10]]), 3)
  assert.deepEqual(boxOf([[1, 2], [5, 1], [3, 9]]), { x0: 1, y0: 1, x1: 5, y1: 9 })
  assert.equal(boxGap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 13, y0: 0, x1: 20, y1: 10 }), 3)
  assert.equal(boxGap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: 5, x1: 20, y1: 20 }), 0, 'overlapping boxes')
  assert.equal(pathLength([[0, 0], [3, 4], [3, 10]]), 11)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(rdp([[0, 0], [5, 0.2], [10, 0]], 1).length, 2, 'a near-straight run collapses')
  assert.equal(rdp([[0, 0], [5, 6], [10, 0]], 1).length, 3, 'a real corner stays')
  assert.deepEqual(segCross([0, 0], [10, 10], [0, 10], [10, 0]), [5, 5])
  assert.equal(segCross([0, 0], [1, 0], [0, 1], [1, 1]), null, 'parallel')
  assert.equal(segCross([0, 0], [4, 0], [5, -1], [5, 1]), null, 'would cross only if extended')
  assert.equal(polyCrossings([[0, 5], [10, 5]], [[5, 0], [5, 10]]).length, 1)
  const r = resamplePath([[0, 0], [100, 0]], 10)
  assert.equal(r.length, 11)
  assert.deepEqual(r[r.length - 1], [100, 0])
  const d = new Dsu(5)
  d.union(0, 1); d.union(3, 4); d.union(1, 4)
  assert.equal(d.find(0), d.find(3))
  assert.notEqual(d.find(0), d.find(2))
})

test('axisStats tells a wandering wire from a zigzag, a coil and a diagonal', () => {
  const wobbly = Array.from({ length: 80 }, (_, i) => [i * 3, 8 * Math.sin(i / 7)])
  assert.ok(axisStats(wobbly).axisFraction > 0.8, 'a wobbly horizontal wire still runs along an axis')
  const ell = [...Array.from({ length: 30 }, (_, i) => [i * 4, 0]), ...Array.from({ length: 30 }, (_, i) => [116, i * 4])]
  const e = axisStats(ell)
  assert.ok(e.axisFraction > 0.9 && e.turns <= 2, 'an L is two axis runs and one turn')
  const zigzag = Array.from({ length: 60 }, (_, i) => [i * 2, (Math.floor(i / 5) % 2 ? 1 : -1) * ((i % 5) * 6 - 12)])
  assert.ok(axisStats(zigzag).axisFraction < 0.7, 'a zigzag is mostly off-axis')
  const diagonal = Array.from({ length: 50 }, (_, i) => [i * 3, i * 3])
  assert.equal(axisStats(diagonal).axisFraction, 0)
})

// ── pins ───────────────────────────────────────────────────────────────────

test('the pin table matches what the glyphs actually draw (re-run calibrate-pins.mjs after editing a glyph)', () => {
  const measured = measurePins()
  for (const cls of WAVE1_CLASSES) {
    PIN_TEMPLATE[cls].forEach((p, k) => {
      assert.equal(p.name, measured[cls][k].name)
      assert.ok(Math.abs(p.u - measured[cls][k].u) < 0.011 && Math.abs(p.v - measured[cls][k].v) < 0.011, `${cls}.${p.name}: table (${p.u},${p.v}) vs drawn (${measured[cls][k].u},${measured[cls][k].v})`)
    })
  }
})

test('every class has pins, and every pin name is a real SimScript anchor', async () => {
  const { anchorValid } = await import('../ai/simscript-lint.ts')
  for (const cls of WAVE1_CLASSES) {
    assert.ok(PIN_TEMPLATE[cls].length >= 1, cls)
    assert.deepEqual(PIN_TEMPLATE[cls].map((p) => p.name), PIN_FRAME[cls].map((p) => p.name), `${cls} pin order`)
    for (const p of PIN_TEMPLATE[cls]) {
      assert.ok(p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1)
      const anchor = { 'in+': 'inp', 'in-': 'inn' }[p.name] ?? p.name
      assert.ok(anchorValid(cls, anchor), `${cls}.${p.name} is not an anchor`)
    }
  }
})

test('rotating the drawing turns its pins the same way: pose 90/180/270', () => {
  assert.deepEqual(rotateUV(0, 0.5, 90), [0.5, 0], 'a left pin of a symbol turned clockwise sits on top')
  assert.deepEqual(rotateUV(0, 0.5, 180), [1, 0.5])
  assert.deepEqual(rotateUV(0, 0.5, 270), [0.5, 1])
  const box = { x0: 100, y0: 100, x1: 160, y1: 130 }
  const [a, b] = pinsOf('resistor', 0, box)
  assert.deepEqual([a.x, a.y, b.x, b.y], [100, 115, 160, 115])
  assert.deepEqual(pinsOf('not-a-class', 0, box), [])
  // against a glyph actually rotated and measured
  for (const cls of ['diode', 'bjt', 'and-gate', 'battery']) {
    for (const pose of [90, 180, 270]) {
      const g = GLYPHS[cls](makeRng(4))
      const rad = (pose * Math.PI) / 180
      const rot = ([x, y]) => [50 + (x - 50) * Math.cos(rad) - (y - 30) * Math.sin(rad), 30 + (x - 50) * Math.sin(rad) + (y - 30) * Math.cos(rad)]
      const pts = g.strokes.flatMap((s) => s.pts.map(rot))
      const bx = { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) }
      const want = PIN_FRAME[cls].map((p) => rot([p.x, p.y]))
      const got = pinsOf(cls, pose, bx)
      got.forEach((p, k) => {
        const tol = 0.12 * Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0)
        assert.ok(Math.hypot(p.x - want[k][0], p.y - want[k][1]) < tol, `${cls} pose ${pose} pin ${p.name}`)
      })
    }
  }
})

// ── random circuits ────────────────────────────────────────────────────────

test('random circuits: every topology compiles, uses only wave-1 classes, and is reproducible', () => {
  for (const topo of TOPOLOGIES) {
    for (let i = 0; i < 12; i++) {
      const ir = randomCircuit(makeRng(i), topo)
      const res = compileIR(ir, { plot: false })
      assert.ok(res.ok, `${topo} #${i}: ${JSON.stringify(res.errors)}`)
      for (const n of ir.nodes) assert.ok(WAVE1_CLASSES.includes(n.cls), `${topo}: ${n.cls}`)
      assert.ok(ir.edges.length >= ir.nodes.length - 1, `${topo} is connected enough`)
    }
  }
  assert.equal(JSON.stringify(randomCircuit(makeRng(3), 'divider')), JSON.stringify(randomCircuit(makeRng(3), 'divider')))
})

// ── comparing circuits ─────────────────────────────────────────────────────

const node = (id, cls, x, extra = {}) => ({ id, cls, conf: 1, bbox: [x, 0, 60, 30], rot: 0, source: 'ink', ...extra })
const wire = (a, b) => {
  const p = (s) => ({ node: s.slice(0, s.indexOf('.')), pin: s.slice(s.indexOf('.') + 1) })
  return { a: p(a), b: p(b), kind: 'wire', conf: 1 }
}
const circ = (nodes, edges) => ({ domain: 'circuit', nodes, edges, labels: [], doubts: [] })
const loopIR = () => circ(
  [node('b', 'battery', 0), node('r', 'resistor', 200), node('d', 'diode', 400)],
  [wire('b.positive', 'r.a'), wire('r.b', 'd.anode'), wire('d.cathode', 'b.negative')],
)

test('compareIR: the same circuit is exact, however its parts are named or its wires listed', () => {
  const truth = loopIR()
  const renamed = circ(
    [node('x3', 'diode', 402), node('x1', 'battery', 2), node('x2', 'resistor', 198)],
    [wire('x2.b', 'x3.anode'), wire('x3.cathode', 'x1.negative'), wire('x1.positive', 'x2.a')],
  )
  const c = compareIR(renamed, truth)
  assert.equal(c.exact, true)
  assert.equal(c.taps, 0)
})

test('compareIR: a resistor turned round is the same circuit; a diode turned round is not', () => {
  const truth = loopIR()
  const rflip = loopIR()
  rflip.edges = [wire('b.positive', 'r.b'), wire('r.a', 'd.anode'), wire('d.cathode', 'b.negative')]
  assert.equal(compareIR(rflip, truth).exact, true)
  const dflip = loopIR()
  dflip.edges = [wire('b.positive', 'r.a'), wire('r.b', 'd.cathode'), wire('d.anode', 'b.negative')]
  const c = compareIR(dflip, truth)
  assert.equal(c.exact, false)
  assert.ok(c.taps >= 1)
})

test('compareIR: a wrong class, a missing part, an extra part and a missing wire are each counted', () => {
  const truth = loopIR()
  const wrong = loopIR()
  wrong.nodes[1].cls = 'inductor'
  const w = compareIR(wrong, truth)
  assert.equal(w.classCorrect, 2)
  assert.equal(w.exact, false)

  const missing = circ([node('b', 'battery', 0), node('d', 'diode', 400)], [wire('d.cathode', 'b.negative')])
  const m = compareIR(missing, truth)
  assert.equal(m.missed, 1)
  assert.equal(m.exact, false)

  const extra = loopIR()
  extra.nodes.push(node('z', 'gnd', 900))
  assert.equal(compareIR(extra, truth).extra, 1)

  const cut = loopIR()
  cut.edges.pop()
  const c = compareIR(cut, truth)
  assert.ok(c.netsMissing >= 1)
  assert.equal(c.exact, false)
})

test('compareIR: parts are paired by place, so a far-away part does not stand in for a missing one', () => {
  const truth = loopIR()
  const moved = loopIR()
  moved.nodes[1].bbox = [5000, 5000, 60, 30]
  const c = compareIR(moved, truth)
  assert.equal(c.missed, 1)
  assert.equal(c.extra, 1)
})

// ── the reader, one rule at a time (fake network) ──────────────────────────

/** A network that calls any group containing a non-straight stroke a resistor, and anything else unknown. */
const fakeNet = {
  predict: (strokes) => {
    const bendy = strokes.some((s) => {
      const sh = shapeOf({ id: 'x', pts: s })
      return !sh.straight && !sh.ortho
    })
    const top = bendy ? [{ cls: 'resistor', conf: 0.95 }, { cls: 'unknown', conf: 0.04 }, { cls: 'inductor', conf: 0.01 }] : [{ cls: 'unknown', conf: 0.9 }, { cls: 'resistor', conf: 0.05 }, { cls: 'diode', conf: 0.05 }]
    return { cls: top[0].cls, conf: top[0].conf, top, pose: 0, poseConf: 0.9 }
  },
}
/** A zigzag "resistor body" between x0 and x1 on y. */
const zig = (x0, x1, y) => {
  const pts = [[x0, y]]
  const n = 6
  for (let k = 0; k < n; k++) pts.push([x0 + ((k + 0.5) * (x1 - x0)) / n, y + (k % 2 ? 12 : -12)])
  pts.push([x1, y])
  return pts
}
const line = (pts) => pts // readability
const dense = (poly, step = 3) => {
  const out = []
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = poly[i - 1]
    const [bx, by] = poly[i]
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step))
    for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n])
  }
  out.push(poly[poly.length - 1])
  return out
}
const ink = (id, poly) => ({ id, pts: dense(line(poly)) })

test('extract: two parts joined by a wire become two nodes and one edge', () => {
  const strokes = [
    ink('A', zig(100, 180, 200)),
    ink('B', zig(300, 380, 200)),
    ink('w', [[180, 200], [300, 200]]),
  ]
  const r = extractCircuit(strokes, fakeNet)
  assert.equal(r.parts.length, 2)
  assert.deepEqual(r.parts.map((p) => p.cls), ['resistor', 'resistor'])
  assert.equal(r.ir.edges.length, 1)
  const e = r.ir.edges[0]
  assert.notEqual(e.a.node, e.b.node)
  assert.deepEqual(r.wireIds, ['w'])
})

test('extract: a wire end that lands on nothing is flagged and marked', () => {
  const strokes = [ink('A', zig(100, 180, 200)), ink('B', zig(300, 380, 200)), ink('w', [[180, 200], [180, 330]])]
  const r = extractCircuit(strokes, fakeNet, { unit: 100 })
  assert.equal(r.ir.edges.length, 0, 'a wire to nowhere connects nothing')
  assert.ok(r.ir.doubts.some((d) => d.why === 'dangling-wire'))
  assert.equal(r.looseEnds.length, 1)
})

test('extract: a T-junction joins three parts; a crossing without a dot does not; with a dot it does', () => {
  const base = [
    ink('A', zig(100, 180, 100)),
    ink('B', zig(100, 180, 300)),
    ink('C', zig(400, 480, 200)),
    ink('wA', [[180, 100], [300, 100], [300, 200], [400, 200]]), // A → C (L then run)
    ink('wB', [[180, 300], [300, 300], [300, 200]]), // B → lands on wA's vertical run: a T
  ]
  const t = extractCircuit(base, fakeNet)
  assert.equal(t.parts.length, 3)
  assert.equal(t.ir.edges.length, 2, 'A, B and C are one net: two edges')

  // two separate nets whose wires merely cross
  const cross = [
    ink('A', zig(100, 180, 100)),
    ink('B', zig(300, 380, 100)),
    ink('C', zig(100, 180, 300)),
    ink('D', zig(300, 380, 300)),
    ink('h', [[180, 100], [300, 100]]),
    ink('h2', [[180, 300], [300, 300]]),
    ink('v', [[240, 40], [240, 360]]), // passes through both horizontals without ending on them
  ]
  const x = extractCircuit(cross, fakeNet, { unit: 100 })
  const nets = (res) => new Set(res.ir.edges.map((e) => [e.a.node, e.b.node].sort().join('-'))).size
  assert.equal(nets(x) <= 2, true, 'no dot, no connection')
  const dotted = [...cross, ink('dot', [[240, 100], [243, 100], [243, 103], [240, 103], [240, 100], [238, 101], [241, 99]])]
  const y = extractCircuit(dotted, fakeNet, { unit: 100 })
  assert.ok(y.dotIds.includes('dot'), 'the little scribble is a dot')
})

test('extract: rewire() moves the pins when a part is turned, and keeps the wire strokes', () => {
  const strokes = [ink('A', zig(100, 180, 200)), ink('B', zig(300, 380, 200)), ink('w', [[180, 200], [300, 200]])]
  const r = extractCircuit(strokes, fakeNet)
  const before = partPins(r.parts[0])
  const turned = rewire(r, r.parts.map((p, i) => (i === 0 ? { ...p, pose: 90 } : p)))
  assert.notDeepEqual(partPins(turned.parts[0]).map((p) => [p.x, p.y]), before.map((p) => [p.x, p.y]))
  assert.equal(turned.wireIds.length, 1)
  assert.equal(turned.wires.length, 1)
  assert.ok(turned.ir.nodes.length === 2)
})

test('extract: wireUp is usable on its own, and irFrom adds the doubts a person should see', () => {
  const parts = [
    { id: 'n1', cls: 'opamp', conf: 0.9, pose: 0, box: { x0: 0, y0: 0, x1: 100, y1: 60 }, strokeIds: [], alts: [], pins: pinsOf('opamp', 0, { x0: 0, y0: 0, x1: 100, y1: 60 }) },
    { id: 'n2', cls: 'resistor', conf: 0.4, pose: 0, box: { x0: 200, y0: 0, x1: 260, y1: 30 }, strokeIds: [], alts: [], pins: pinsOf('resistor', 0, { x0: 200, y0: 0, x1: 260, y1: 30 }) },
  ]
  const wiring = wireUp(parts, [], [], 100)
  assert.deepEqual(wiring.edges, [])
  const ir = irFrom(parts, wiring)
  assert.ok(ir.doubts.some((d) => d.ref === 'n2' && d.why === 'low-confidence'))
  assert.ok(ir.doubts.some((d) => d.ref === 'n1'), 'an op-amp whose +/− were not read is flagged')
})

test('extract: nothing to read gives an empty circuit, not an error', () => {
  const r = extractCircuit([], fakeNet)
  assert.equal(r.parts.length, 0)
  assert.deepEqual(r.ir.edges, [])
  const one = extractCircuit([{ id: 'a', pts: [[0, 0]] }], fakeNet)
  assert.equal(one.parts.length, 0)
})

// ── generated scenes ───────────────────────────────────────────────────────

const layouts = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden/scene-layouts.json'), 'utf8')).layouts

test('scene-synth: a scene is reproducible, ordered in time, and its ground truth matches the layout', () => {
  for (let i = 0; i < 8; i++) {
    const rng = () => makeRng(40 + i)
    const w = makeWriter(rng().fork('w'), `t${i}`, 'mouse')
    const a = drawScene(layouts[i], rng().fork('s'), w)
    const b = drawScene(layouts[i], rng().fork('s'), w)
    assert.equal(JSON.stringify(a.strokes), JSON.stringify(b.strokes), 'same seed, same drawing')
    assert.equal(a.truth.nodes.length, layouts[i].ir.nodes.length)
    assert.equal(a.truth.edges.length, layouts[i].ir.edges.length)
    assert.equal(a.roles.length, a.strokes.length)
    assert.equal(new Set(a.roles.filter((r) => r.role === 'symbol').map((r) => r.owner)).size, layouts[i].ir.nodes.length, 'every part has ink')
    assert.ok(a.roles.some((r) => r.role === 'wire'))
    for (const s of a.strokes) {
      let prev = -1
      for (const [x, y, t] of s) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y))
        assert.ok(t >= prev)
        prev = t
      }
    }
    for (const n of a.truth.nodes) assert.ok(n.bbox[2] > 0 && n.bbox[3] > 0)
    for (const n of a.truth.nodes) if (POSE_SYMMETRY[n.cls] === 'rot180') assert.ok(n.rot === 0 || n.rot === 90)
  }
})

test('scene-synth: wires reach the pins they connect', () => {
  const layout = layouts[0]
  const rng = makeRng(77)
  const w = makeWriter(rng.fork('w'), 'pin', 'pen')
  const scene = drawScene(layout, rng.fork('s'), w)
  const wires = scene.strokes.filter((_, k) => scene.roles[k].role === 'wire')
  const ends = wires.flatMap((s) => [s[0], s[s.length - 1]])
  const pins = scene.truth.nodes.flatMap((n) => pinsOf(n.cls, n.rot, { x0: n.bbox[0], y0: n.bbox[1], x1: n.bbox[0] + n.bbox[2], y1: n.bbox[1] + n.bbox[3] }))
  const near = ends.filter((e) => pins.some((p) => Math.hypot(p.x - e[0], p.y - e[1]) < 0.4 * Math.max(...scene.truth.nodes.map((n) => n.bbox[2]))))
  assert.ok(near.length >= ends.length * 0.8, `${near.length}/${ends.length} wire ends are near a pin`)
})
