// Schematic layout contract — drives the REAL executeSimScript, not a copy.
// Run: node --test lib/scene/circuit-layout.test.mjs
//
// These assert the properties an electrical schematic must have, not specific
// coordinates: pinning coordinates is what made the old layout untouchable.
//
//   1. Every wire segment is orthogonal (horizontal or vertical).
//   2. Every wire END lands exactly on the pin it claims — the netlist is built
//      from coincident world points (lib/circuit/engine.ts), so a wire that
//      misses its pin means the scene SOLVES a different circuit than it shows.
//   3. No two component bodies overlap.
//   4. No wire cuts through a component body it doesn't terminate on.
//   5. Mechanics connectors are never touched by the schematic layout.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'circuit-layout-'))
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
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`,
  '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe' })

const { executeSimScript, useDocStore, terminalsOf, terminalWorld } = await import(bundle)

/** With a layout surface — the 4th argument the AI panel really passes, which
 *  is what turns the placement pass on. Without it the script's own
 *  coordinates stand and every layout bug is invisible. */
const run = (src) => {
  useDocStore.__reset()
  executeSimScript('p', src, { x: 200, y: 100 }, {
    bounds: { left: 0, top: 0, right: 1400, bottom: 900 }, fixedFrame: false,
  })
  return useDocStore.__objects()
}

const symbols = (objs) => objs.filter((o) => o.geometry.kind === 'symbol')
const wires = (objs) => objs.filter((o) => o.geometry.kind === 'line')
const worldPts = (o) => (o.geometry.points ?? []).map(([x, y]) => ({ x: x + o.position.x, y: y + o.position.y }))

/** Half-extent after rotation — 90/270 swap width and height. */
const rectOf = (o) => {
  const cx = o.position.x + o.size.w / 2
  const cy = o.position.y + o.size.h / 2
  const swap = o.rotation === 90 || o.rotation === 270
  const hw = (swap ? o.size.h : o.size.w) / 2
  const hh = (swap ? o.size.w : o.size.h) / 2
  return { x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh, id: o.id, s: o.geometry.symbol }
}

const CIRCUITS = {
  'series loop': `
    b = create("battery", { voltage: 9 })
    r1 = create("resistor", { resistance: 100 })
    r2 = create("resistor", { resistance: 220 })
    l = create("bulb")
    connect(b.positive, r1.a); connect(r1.b, r2.a)
    connect(r2.b, l.a); connect(l.b, b.negative)
  `,
  'parallel bank': `
    b = create("battery", { voltage: 12 })
    r1 = create("resistor"); r2 = create("resistor"); r3 = create("resistor")
    connect(b.positive, r1.a); connect(r1.b, b.negative)
    connect(b.positive, r2.a); connect(r2.b, b.negative)
    connect(b.positive, r3.a); connect(r3.b, b.negative)
  `,
  'divider with meter and gnd': `
    b = create("battery", { voltage: 10 })
    r1 = create("resistor"); r2 = create("resistor")
    g = create("gnd"); v = create("voltmeter")
    connect(b.positive, r1.a); connect(r1.b, r2.a); connect(r2.b, b.negative)
    connect(b.negative, g.a); connect(v.a, r2.a); connect(v.b, r2.b)
  `,
  'common-emitter amplifier': `
    vcc = create("battery", { voltage: 12 })
    q = create("bjt")
    rc = create("resistor"); re = create("resistor")
    r1 = create("resistor"); r2 = create("resistor")
    cin = create("capacitor"); cout = create("capacitor")
    sig = create("ac-source"); g = create("gnd")
    connect(vcc.positive, rc.a); connect(rc.b, q.c)
    connect(q.e, re.a); connect(re.b, vcc.negative)
    connect(vcc.positive, r1.a); connect(r1.b, q.b)
    connect(q.b, r2.a); connect(r2.b, vcc.negative)
    connect(sig.positive, cin.a); connect(cin.b, q.b)
    connect(sig.negative, vcc.negative)
    connect(q.c, cout.a); connect(vcc.negative, g.a)
  `,
  'full adder': `
    a = create("input"); bb = create("input"); cin = create("input")
    x1 = create("xor-gate"); x2 = create("xor-gate")
    a1 = create("and-gate"); a2 = create("and-gate"); o1 = create("or-gate")
    s = create("output"); co = create("output")
    connect(a.out, x1.a); connect(bb.out, x1.b)
    connect(x1.out, x2.a); connect(cin.out, x2.b); connect(x2.out, s.a)
    connect(a.out, a1.a); connect(bb.out, a1.b)
    connect(x1.out, a2.a); connect(cin.out, a2.b)
    connect(a1.out, o1.a); connect(a2.out, o1.b); connect(o1.out, co.a)
  `,
  'diode bridge': `
    src = create("ac-source")
    d1 = create("diode"); d2 = create("diode"); d3 = create("diode"); d4 = create("diode")
    rl = create("resistor")
    connect(src.positive, d1.anode); connect(src.positive, d2.cathode)
    connect(src.negative, d3.anode); connect(src.negative, d4.cathode)
    connect(d1.cathode, d3.cathode); connect(d2.anode, d4.anode)
    connect(d1.cathode, rl.a); connect(rl.b, d2.anode)
  `,
}

for (const [name, src] of Object.entries(CIRCUITS)) {
  test(`${name}: every wire segment is orthogonal`, () => {
    for (const w of wires(run(src))) {
      const pts = worldPts(w)
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        const diagonal = Math.abs(a.x - b.x) > 0.6 && Math.abs(a.y - b.y) > 0.6
        assert.ok(!diagonal,
          `diagonal segment (${a.x},${a.y})->(${b.x},${b.y}) — schematics run at right angles`)
      }
    }
  })

  test(`${name}: every wire end is electrically connected`, () => {
    // The electrical contract, not a cosmetic one: the netlist unions terminals
    // and wire ends by coincident world points, so an end that touches nothing
    // is a connection the solver never sees.
    //
    // An end may land on a PIN, or — when several connections leave one pin —
    // on another wire of the same net, which is what a junction dot is. That
    // second case is why this no longer demands "lands exactly on a pin": the
    // fan-out branch legitimately starts partway along its sibling.
    const objs = run(src)
    const pins = symbols(objs).flatMap((o) => terminalsOf(o).map((t) => terminalWorld(o, t)))
    const paths = wires(objs).map(worldPts)

    const onSegment = (p, a, b, eps = 0.01) => {
      const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
      if (Math.abs(cross) > eps * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) return false
      const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
      return dot >= -eps && dot <= len2 + eps
    }

    paths.forEach((pts, i) => {
      for (const p of [pts[0], pts[pts.length - 1]]) {
        if (pins.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.5)) continue
        const onNet = paths.some((o, j) =>
          j !== i && o.slice(1).some((b, k) => onSegment(p, o[k], b)))
        assert.ok(onNet,
          `wire end (${p.x.toFixed(1)},${p.y.toFixed(1)}) touches neither a pin nor another wire`)
      }
    })
  })

  test(`${name}: every pair of components clears 20px`, () => {
    // Rule 2's hard floor. Overlap is the extreme case, but anything under
    // CLEARANCE reads as one blob, so assert the gap itself. Clearance is a
    // constraint in the optimiser, never a cost term — a penalty is a bribe
    // the search will pay to buy a shorter wire.
    const rs = symbols(run(src)).map(rectOf)
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j]
        const dx = Math.max(b.x1 - a.x2, a.x1 - b.x2, 0)
        const dy = Math.max(b.y1 - a.y2, a.y1 - b.y2, 0)
        const gap = dx === 0 && dy === 0 ? 0 : Math.hypot(dx, dy)
        assert.ok(gap >= 20 - 0.01, `components ${gap.toFixed(1)}px apart — the floor is 20`)
      }
  })

  test(`${name}: the drawing is compact, not sprawled`, () => {
    // Rule 2's objective. Component area over bounding-box area: the
    // force-directed placement this replaced scored 0.04–0.13, i.e. drawings
    // that were 87–96% empty space. Anything under 0.15 is sprawl again.
    const comps = symbols(run(src))
    const rs = comps.map(rectOf)
    const xs = rs.flatMap((r) => [r.x1, r.x2])
    const ys = rs.flatMap((r) => [r.y1, r.y2])
    const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
    const area = comps.reduce((s, o) => s + o.size.w * o.size.h, 0)
    // 0.09 is the floor, not the target. Keeping every wire out of every body
    // costs room: parts must leave routing lanes between them, so a drawing
    // that packed to 0.48 when wires were allowed to cut through components
    // legitimately loosens. The bar is set to catch a return to the old
    // force-directed sprawl (0.04) rather than to chase density.
    assert.ok(area / box > 0.09, `fill ${(area / box).toFixed(2)} — layout has sprawled`)
  })

  test(`${name}: no wire is drawn through a component body`, () => {
    // This test used to ask whether the segment's bounding box overlapped the
    // body's on BOTH axes by >6px. Every wire here is orthogonal, so one axis
    // of that box always has zero extent and the condition could never be
    // true: it reported a clean sheet while wires ran the full width of gates.
    // A correct check clips the segment against the rectangle (Liang-Barsky),
    // which works for zero-width segments.
    //
    // Bodies this net terminates on are NOT exempt — a wire spanning the very
    // component it connects to is the defect. The one allowance is that some
    // symbols put the pin inside the outline (gnd sits at y=0.12), so the leg
    // that ends on a terminal may reach in as deep as that pin sits.
    const objs = run(src)
    const boxes = symbols(objs).map(rectOf)
    const pins = symbols(objs).flatMap((o) => terminalsOf(o).map((t) => terminalWorld(o, t)))

    const insideRun = (a, b, r) => {
      let t0 = 0, t1 = 1
      const dx = b.x - a.x, dy = b.y - a.y
      const p = [-dx, dx, -dy, dy]
      const q = [a.x - r.x1, r.x2 - a.x, a.y - r.y1, r.y2 - a.y]
      for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return 0; continue }
        const t = q[i] / p[i]
        if (p[i] < 0) { if (t > t1) return 0; if (t > t0) t0 = t }
        else { if (t < t0) return 0; if (t < t1) t1 = t }
      }
      return Math.max(0, t1 - t0) * Math.hypot(dx, dy)
    }

    for (const w of wires(objs)) {
      const pts = worldPts(w)
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        const term = pins.find((q) => Math.hypot(q.x - a.x, q.y - a.y) < 0.5)
          ?? pins.find((q) => Math.hypot(q.x - b.x, q.y - b.y) < 0.5)
        for (const box of boxes) {
          const run_ = insideRun(a, b, box)
          if (run_ <= 1) continue
          if (term) {
            const depth = Math.min(
              Math.abs(term.x - box.x1), Math.abs(box.x2 - term.x),
              Math.abs(term.y - box.y1), Math.abs(box.y2 - term.y))
            if (run_ <= depth + 2) continue
          }
          assert.fail(
            `wire runs ${run_.toFixed(1)}px through ${box.s ?? 'a component'} — ` +
            `schematics never draw a wire across a body`)
        }
      }
    }
  })
}

test('a meter across a component gets two distinct wires, not one collapsed stub', () => {
  // The regression: the re-router matched wires by the two OBJECT IDS only, so
  // both voltmeter leads matched the same wire — one was routed twice and the
  // other stayed the zero-length stub connect() drew, i.e. not connected at all.
  const objs = run(CIRCUITS['divider with meter and gnd'])
  const vm = symbols(objs).find((o) => o.geometry.symbol === 'voltmeter')
  const leads = wires(objs).filter((w) =>
    w.behaviors.some((b) => b.params.targetA?.value === vm.id || b.params.targetB?.value === vm.id))
  assert.equal(leads.length, 2, 'a voltmeter has two leads')
  for (const w of leads) {
    const pts = worldPts(w)
    const span = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y)
    assert.ok(span > 1, 'a collapsed lead is an electrically absent connection')
  }
})

test('the same script always lays out identically', () => {
  // The optimiser is stochastic, so its PRNG is seeded, not random. A course
  // figure that reshuffled between page loads would be unusable.
  const once = () => symbols(run(CIRCUITS['diode bridge']))
    .map((o) => `${o.geometry.symbol}@${o.position.x},${o.position.y},${o.rotation}`).sort().join('|')
  assert.equal(once(), once(), 'layout must be deterministic')
})

test('mechanics connectors are left alone by the schematic layout', () => {
  // circuitEdges also records rod/spring links, but a connector's endpoints ARE
  // its physics attachment (buildWorld pairs bodies by what sits under them),
  // so routing one as a wire silently detaches the simulation.
  const objs = run(`
    pivot = create("hinge", { x: 320, y: 100 })
    bob = create("mass", { x: 320, y: 340, mass: 1 })
    connect(pivot.centre, bob.centre, "rod")
  `)
  const rod = objs.find((o) => o.behaviors.some((b) => b.type === 'rod'))
  const centre = (o) => ({ x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 })
  const pts = worldPts(rod)
  const pivot = objs.find((o) => o.behaviors.some((b) => b.type === 'hinge'))
  const bob = objs.find((o) => o.behaviors.some((b) => b.type === 'rigidBody'))
  assert.deepEqual(pts[0], centre(pivot), 'rod start must stay on the pivot')
  assert.deepEqual(pts[pts.length - 1], centre(bob), 'rod end must stay on the bob')
})
