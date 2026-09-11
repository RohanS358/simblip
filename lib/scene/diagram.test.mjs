// The diagram language: parsing, ranking, placement and routing.
// Run: node --test lib/scene/diagram.test.mjs
//
// Pure module, so it is bundled once and exercised directly — no store, no
// DOM, no browser. Everything the lint gate checks is checked here first.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'diagram-test-'))
const bundle = join(dir, 'diagram.mjs')
// connectors.ts rides along: the claim that a dragged node keeps its arrows
// rests on this module's `t` agreeing with that module's reprojection, and the
// only way to check an agreement is to hold both to it.
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `
export * from '@/lib/scene/diagram'
export { pointAtBoundaryT } from '@/lib/scene/connectors'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm',
  `--outfile=${bundle}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { parseDiagram, layoutDiagram, buildDiagram, wrapLabel, sideT, styleFor, pointAtBoundaryT } =
  await import(bundle)

const node = (d, id) => d.nodes.find((n) => n.id === id)

test('a node declaration takes its shape from its brackets', () => {
  const d = parseDiagram(`
    [Measure it]
    (Done)
    <Is it ohmic?> as q
    ((Junction))
  `)
  assert.deepEqual(d.errors, [])
  assert.equal(node(d, 'measure-it').shape, 'box')
  assert.equal(node(d, 'done').shape, 'round')
  assert.equal(node(d, 'q').shape, 'diamond')
  assert.equal(node(d, 'q').label, 'Is it ohmic?')
  assert.equal(node(d, 'junction').shape, 'circle')
})

test('an edge may name a node that was never declared', () => {
  // The shortest useful diagram is two names and an arrow. Requiring
  // declarations first would make the source longer than the picture.
  const d = parseDiagram('Start -> Stop')
  assert.deepEqual(d.errors, [])
  assert.equal(d.nodes.length, 2)
  assert.equal(d.edges.length, 1)
  assert.equal(node(d, 'start').shape, 'box')
})

test('a later declaration refines a node an edge created', () => {
  const d = parseDiagram(`
    a -> q
    <Ohmic?> as q
  `)
  assert.equal(node(d, 'q').shape, 'diamond')
  assert.equal(d.nodes.length, 2, 'the refined node must not be duplicated')
})

test('edges carry their style and label', () => {
  const d = parseDiagram(`
    a -> b : 5 V
    b --> c
    c -- d
  `)
  assert.deepEqual(d.edges.map((e) => e.style), ['arrow', 'dashed', 'plain'])
  assert.equal(d.edges[0].label, '5 V')
  assert.equal(d.edges[1].label, undefined)
})

test('a node can be referenced by its label as well as its id', () => {
  const d = parseDiagram(`
    [Find total R] as rt
    Find total R -> [Done]
  `)
  assert.deepEqual(d.errors, [])
  assert.equal(d.edges[0].from, 'rt')
  assert.equal(d.nodes.length, 2, 'referencing by label must not create a second node')
})

test('nonsense is reported with its line number, not silently dropped', () => {
  const d = parseDiagram(`
    [Fine]
    this line is not a statement
  `)
  assert.equal(d.errors.length, 1)
  assert.match(d.errors[0], /line 3/)
  assert.equal(d.nodes.length, 1, 'the statements that parsed still stand')
})

test('a self-loop is refused rather than drawn as a dot', () => {
  const d = parseDiagram('a -> a')
  assert.match(d.errors[0], /points at itself/)
  assert.equal(d.edges.length, 0)
})

test('an empty source is an error, not an empty diagram', () => {
  assert.match(parseDiagram('# just a comment').errors[0], /declares no nodes/)
})

test('direction is read, and an unknown one is named', () => {
  assert.equal(parseDiagram('direction: right\n[a]').direction, 'right')
  assert.equal(parseDiagram('direction: lr\n[a]').direction, 'right')
  assert.equal(parseDiagram('[a]').direction, 'down', 'default is a column')
  assert.match(parseDiagram('direction: sideways\n[a]').errors[0], /not one of/)
})

test('an unknown accent is named instead of being applied', () => {
  const d = parseDiagram('[a] as a #chartreuse')
  assert.match(d.errors[0], /not an accent/)
  assert.equal(node(d, 'a').accent, undefined)
})

test('labels wrap on words, never mid-word', () => {
  const lines = wrapLabel('Apply Ohm law to the resistor only')
  assert.ok(lines.length > 1)
  for (const l of lines) assert.ok(l.length <= 22, `"${l}" is too long`)
  assert.equal(lines.join(' '), 'Apply Ohm law to the resistor only')
})

test('ranking lays a chain out along the flow, one rank per step', () => {
  const l = buildDiagram('a -> b\nb -> c')
  const [a, b, c] = ['a', 'b', 'c'].map((id) => l.nodes.find((n) => n.id === id))
  assert.ok(a.y < b.y && b.y < c.y, 'a column must advance downward')
  assert.ok(b.y - (a.y + a.h) > 40, 'ranks need a gap for the edge to route through')
})

test('direction: right lays the same chain out across the page', () => {
  const l = buildDiagram('direction: right\na -> b\nb -> c')
  const [a, b] = ['a', 'b'].map((id) => l.nodes.find((n) => n.id === id))
  assert.ok(a.x < b.x, 'a row must advance rightward')
  assert.equal(a.y, b.y, 'a chain in a row shares one line')
})

test('siblings share a rank and never overlap', () => {
  const l = buildDiagram(`
    [Source] as s
    s -> [Branch one]
    s -> [Branch two]
  `)
  const one = l.nodes.find((n) => n.id === 'branch-one')
  const two = l.nodes.find((n) => n.id === 'branch-two')
  assert.equal(one.y, two.y, 'both branches sit on the same rank')
  assert.ok(one.x + one.w <= two.x || two.x + two.w <= one.x, 'siblings must not overlap')
})

test('no two nodes overlap in a wider diagram', () => {
  const l = buildDiagram(`
    a -> b
    a -> c
    b -> d
    c -> d
    d -> e
    d -> f
  `)
  for (const p of l.nodes) {
    for (const q of l.nodes) {
      if (p.id >= q.id) continue
      const clear = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y
      assert.ok(clear, `${p.id} overlaps ${q.id}`)
    }
  }
})

test('a cycle still lays out, with the closing edge routed outside', () => {
  // A feedback loop IS most control diagrams. Ranking a cycle is impossible,
  // so the closing edge is taken out of the ranking and drawn around the side.
  const l = buildDiagram(`
    [Plant] as p
    [Sensor] as s
    p -> s
    s -> p : feedback
  `)
  assert.deepEqual(l.errors, [])
  const p = l.nodes.find((n) => n.id === 'p')
  const s = l.nodes.find((n) => n.id === 's')
  assert.ok(p.y < s.y, 'the forward edge still sets the order')
  const backEdge = l.edges.find((e) => e.from === 's' && e.to === 'p')
  assert.ok(backEdge.bends.length === 2, 'the return path routes around, not straight back through')
  assert.ok(backEdge.bends.every((b) => b.x > Math.max(p.x + p.w, s.x + s.w)), 'it runs outside the boxes')
})

test('edges leave and enter on the flow-facing sides', () => {
  const l = buildDiagram('a -> b')
  const [a, b] = ['a', 'b'].map((id) => l.nodes.find((n) => n.id === id))
  const e = l.edges[0]
  assert.equal(e.a.y, a.y + a.h, 'leaves the bottom')
  assert.equal(e.b.y, b.y, 'enters the top')
})

test('a straight run has no bends; an offset one turns exactly twice', () => {
  const straight = buildDiagram('a -> b').edges[0]
  assert.equal(straight.bends.length, 0)
  const branched = buildDiagram(`
    [Source] as s
    s -> [Left branch] as l
    s -> [Right branch] as r
  `)
  const offset = branched.edges[0]
  assert.equal(offset.bends.length, 2, 'orthogonal routing means two corners')
  assert.equal(offset.bends[0].y, offset.bends[1].y, 'the middle segment is level')
  // The inline `as l` names the node; it is not part of the label.
  assert.equal(branched.nodes.find((n) => n.id === 'l').label, 'Left branch')
  assert.equal(branched.nodes.length, 3)
})

test('endpoint boundary parameters round-trip to the same side', () => {
  // `t` is what anchors the drawn edge to its node, so it must agree with
  // lib/scene/connectors.ts's clockwise-from-top-left parameterisation, or a
  // dragged node drags its arrows to the wrong edge.
  const w = 120, h = 60
  const per = 2 * (w + h)
  assert.equal(sideT('box', w, h, 'top'), w / 2 / per)
  assert.equal(sideT('box', w, h, 'right'), (w + h / 2) / per)
  assert.equal(sideT('box', w, h, 'bottom'), (w + h + w / 2) / per)
  assert.equal(sideT('box', w, h, 'left'), (w + h + w + h / 2) / per)
  assert.equal(sideT('circle', w, h, 'top'), 0)
  assert.equal(sideT('circle', w, h, 'bottom'), 0.5)
})

test('a group encloses its members and titles them', () => {
  const l = buildDiagram(`
    [Sensor] as s
    [Filter] as f
    s -> f
    group "Front end" { s, f }
  `)
  assert.equal(l.groups.length, 1)
  const g = l.groups[0]
  for (const id of ['s', 'f']) {
    const n = l.nodes.find((x) => x.id === id)
    assert.ok(n.x >= g.x && n.x + n.w <= g.x + g.w, `${id} is inside the group horizontally`)
    assert.ok(n.y >= g.y && n.y + n.h <= g.y + g.h, `${id} is inside the group vertically`)
  }
  assert.ok(g.y + 20 <= l.nodes[0].y, 'the group leaves room above for its title')
})

test('the layout starts at the origin and reports its own extent', () => {
  const l = buildDiagram(`
    [Sensor] as s
    [Filter] as f
    s -> f
    group "Front end" { s, f }
  `)
  assert.ok(Math.min(...l.nodes.map((n) => n.x), ...l.groups.map((g) => g.x)) >= 0)
  assert.ok(Math.min(...l.nodes.map((n) => n.y), ...l.groups.map((g) => g.y)) >= 0)
  assert.ok(l.width >= Math.max(...l.nodes.map((n) => n.x + n.w)))
  assert.ok(l.height >= Math.max(...l.nodes.map((n) => n.y + n.h)))
})

test('a diamond is bigger than its text needs, because its interior is not', () => {
  const l = buildDiagram('<Constant R?> as q\n[Constant R?] as b')
  const q = l.nodes.find((n) => n.id === 'q')
  const b = l.nodes.find((n) => n.id === 'b')
  assert.ok(q.w > b.w && q.h > b.h)
})

test('styles are theme tokens, never literal colours', () => {
  for (const shape of ['box', 'round', 'diamond', 'circle']) {
    const s = styleFor({ id: 'x', label: 'x', shape })
    assert.match(s.fill, /var\(--/)
    assert.match(s.stroke, /var\(--/)
    assert.doesNotMatch(s.fill, /#[0-9a-f]{3,8}/i)
  }
  assert.match(styleFor({ id: 'x', label: 'x', shape: 'box', accent: 'rose' }).stroke, /accent-rose/)
  assert.match(styleFor({ id: 'x', label: 'x', shape: 'box', accent: 'gray' }).stroke, /muted-foreground/)
})

test('layout is deterministic — the same source twice is the same picture', () => {
  const src = `
    direction: right
    [In] as i
    <Split?> as s
    [Out A] as a
    [Out B] as b
    i -> s
    s -> a : yes
    s -> b : no
  `
  const one = JSON.stringify(buildDiagram(src))
  const two = JSON.stringify(buildDiagram(src))
  assert.equal(one, two)
})

test('groups never overlap each other or a node outside them', () => {
  // A container is padded out from its members and carries a title band above
  // them, so the spacing that reads well for bare nodes put one group's title
  // inside its neighbour's box.
  const l = buildDiagram(`
    direction: right
    [Series] as s
    s -> [One path] as p1
    p1 -> [Voltage divides] as v1
    [Parallel] as par
    par -> [Two paths] as p2
    p2 -> [Current divides] as v2
    group "Series" { s, p1, v1 }
    group "Parallel" { par, p2, v2 }
  `)
  assert.equal(l.groups.length, 2)
  const [a, b] = l.groups
  const clear = (p, q) => p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y
  assert.ok(clear(a, b), 'the two containers overlap')
  const members = new Set(['s', 'p1', 'v1'])
  for (const n of l.nodes.filter((x) => !members.has(x.id))) {
    assert.ok(clear(a, n), `${n.id} sits inside a group it is not a member of`)
  }
})

test("a colon inside a node's own label is not an edge label", () => {
  // `q -> [Diode: fixed Vf]` — splitting on the last colon would name the
  // edge "fixed Vf]" and leave the node called "[Diode".
  const d = parseDiagram('q -> [Diode and LED: one direction, fixed Vf] as led : no')
  assert.deepEqual(d.errors, [])
  assert.equal(node(d, 'led').label, 'Diode and LED: one direction, fixed Vf')
  assert.equal(d.edges[0].label, 'no')
  assert.equal(d.edges[0].to, 'led')
})

test('an edge that skips a rank is routed around, not through the boxes between', () => {
  // A flowchart's early exit ("no" jumping past the next step) was drawn as a
  // straight vertical line — straight through whatever sat in between, with
  // its label printed on top of that box.
  const l = buildDiagram(`
    [Step one] as a
    [Step two] as b
    [Done] as c
    a -> b
    b -> c
    a -> c : skip
  `)
  const skip = l.edges.find((e) => e.label === 'skip')
  const b = l.nodes.find((n) => n.id === 'b')
  assert.ok(skip.bends.length >= 2, 'a skipping edge has to turn out of the flow')
  assert.ok(
    skip.bends.some((p) => p.x > b.x + b.w),
    'it must run in a lane clear of the node it skips'
  )
  assert.ok(l.width > Math.max(...l.nodes.map((n) => n.x + n.w)), 'the lane is inside the reported extent')
})

test('two detoured edges take different lanes', () => {
  const l = buildDiagram(`
    [a] as a
    [b] as b
    [c] as c
    [d] as d
    a -> b
    b -> c
    c -> d
    a -> d : one
    b -> d : two
  `)
  const lanes = l.edges.filter((e) => e.label).map((e) => e.bends[0].x)
  assert.equal(new Set(lanes).size, lanes.length, 'detours must not share a lane')
})

test('a plain chain lines up, so its edges run straight', () => {
  // Greedy packing spaces a rank evenly, which left a chain of
  // differently-sized boxes slightly out of line — every edge drew a small
  // jog, and a column of jogs reads as a mistake rather than as a diagram.
  const l = buildDiagram(`
    [A short one] as a
    a -> [A considerably longer label here] as b
    b -> [Mid] as c
  `)
  const centre = (n) => n.x + n.w / 2
  const [a, b, c] = ['a', 'b', 'c'].map((id) => l.nodes.find((n) => n.id === id))
  assert.ok(Math.abs(centre(a) - centre(b)) < 1, 'a and b are not aligned')
  assert.ok(Math.abs(centre(b) - centre(c)) < 1, 'b and c are not aligned')
  for (const e of l.edges) assert.equal(e.bends.length, 0, 'an aligned pair needs no corners')
})

test("an edge's anchors reproject to the side it left, wherever the node moves", () => {
  // This is the whole basis for "drag a box and its arrows follow": the store
  // re-resolves each end from its boundary parameter against the node's
  // CURRENT position and size (lib/store/document.ts). If this module's `t`
  // and lib/scene/connectors.ts's parameterisation ever disagree, the arrows
  // quietly reattach to the wrong edge.
  const l = buildDiagram('[Source] as s\ns -> [Target] as t')
  const e = l.edges[0]
  const asObj = (n, dx = 0, dy = 0) => ({
    geometry: { kind: n.shape === 'circle' ? 'circle' : 'rect' },
    position: { x: n.x + dx, y: n.y + dy },
    size: { w: n.w, h: n.h },
  })
  const s = l.nodes.find((n) => n.id === 's')
  const t = l.nodes.find((n) => n.id === 't')

  const here = pointAtBoundaryT(asObj(s), e.aT)
  assert.ok(Math.abs(here.x - e.a.x) < 0.5 && Math.abs(here.y - e.a.y) < 0.5,
    'the drawn endpoint and its anchor must describe the same point')

  // Now move the source 200 right and 60 down, as a drag would.
  const moved = pointAtBoundaryT(asObj(s, 200, 60), e.aT)
  assert.ok(Math.abs(moved.x - (e.a.x + 200)) < 0.5 && Math.abs(moved.y - (e.a.y + 60)) < 0.5,
    'the endpoint must travel with its node')
  const bEnd = pointAtBoundaryT(asObj(t), e.bT)
  assert.ok(Math.abs(bEnd.y - t.y) < 0.5, 'the arrowhead stays on the target\'s top edge')
})
