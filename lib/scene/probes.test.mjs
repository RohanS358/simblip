// Self-check for probe geometry: orthogonal routing + arrowhead direction.
// No test framework in this project — run it directly:
//   node lib/scene/probes.test.mjs
//
// Pure geometry is duplicated here rather than imported (probes.ts is a
// 'use client' TS module pulling in the circuit engine). Keep in sync with
// orthPath / endDirection in lib/scene/probes.ts.

import assert from 'node:assert/strict'

const orthPath = (a, b, lead = 0) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) < 1 && (lead === 0 || Math.sign(dx) === Math.sign(lead))) {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  }
  if (Math.abs(dx) < 1 && lead === 0) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  if (lead !== 0) {
    const exit = a.x + lead
    if (Math.sign(b.x - exit) === Math.sign(lead) || Math.abs(b.x - exit) < 1) {
      const midX = exit + (b.x - exit) / 2
      return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`
    }
    return `M ${a.x} ${a.y} L ${exit} ${a.y} L ${exit} ${b.y} L ${b.x} ${b.y}`
  }
  if (Math.abs(dx) < 24) return `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`
  const midX = a.x + dx / 2
  return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`
}

const LEAD_OUT = 18
const leadDirection = (box, origin, target) => {
  const right = box.x + box.w
  if (target.x > right) return 1
  return origin.x - box.x <= right - origin.x ? -1 : 1
}
const leadDistance = (box, origin, lead) => {
  const edge = lead < 0 ? box.x : box.x + box.w
  return Math.max(LEAD_OUT, Math.abs(origin.x - edge) + LEAD_OUT)
}

/** Every segment of a path must be axis-aligned — that's the whole point. */
function assertOrthogonal(d) {
  const pts = d
    .split(/[ML]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).map(Number))
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const horizontal = Math.abs(y1 - y0) < 1e-9
    const vertical = Math.abs(x1 - x0) < 1e-9
    assert.ok(horizontal || vertical, `segment ${i} of "${d}" is diagonal`)
  }
  return pts
}

// ── routing ─────────────────────────────────────────────────────────────────
const z = orthPath({ x: 0, y: 0 }, { x: 100, y: 60 })
let pts = assertOrthogonal(z)
assert.deepEqual(pts[0], [0, 0], 'starts at the probe')
assert.deepEqual(pts[pts.length - 1], [100, 60], 'ends at the target')
assert.equal(pts.length, 4, 'Z route has 4 points')

// Close horizontally → single-elbow L, still orthogonal and still connecting.
const l = orthPath({ x: 0, y: 0 }, { x: 10, y: 80 })
pts = assertOrthogonal(l)
assert.deepEqual(pts[pts.length - 1], [10, 80], 'L reaches the target')

// Collinear cases must not emit a degenerate elbow that doubles back.
assert.equal(orthPath({ x: 0, y: 5 }, { x: 50, y: 5 }), 'M 0 5 L 50 5', 'pure horizontal')
assert.equal(orthPath({ x: 7, y: 0 }, { x: 7, y: 40 }), 'M 7 0 L 7 40', 'pure vertical')

// Right-to-left routing works the same (target behind the probe).
pts = assertOrthogonal(orthPath({ x: 200, y: 0 }, { x: 40, y: 90 }))
assert.deepEqual(pts[pts.length - 1], [40, 90], 'leftward Z reaches target')

// ── arrowhead direction ─────────────────────────────────────────────────────
// Derived from the path itself, exactly as the real endDirection does — the
// two must never be able to disagree about which way the arrow points.
const endDirection = (a, b, lead = 0) => {
  const nums = orthPath(a, b, lead)
    .split(/[ML]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).map(Number))
  const last = nums[nums.length - 1]
  const prev = nums[nums.length - 2] ?? last
  const dx = last[0] - prev[0]
  const dy = last[1] - prev[1]
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x: 1, y: 0 }
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) || 1 }
}

// The head must point along the path's LAST segment, or it renders sideways.
for (const [a, b] of [
  [{ x: 0, y: 0 }, { x: 100, y: 60 }],
  [{ x: 200, y: 0 }, { x: 40, y: 90 }],
  [{ x: 0, y: 5 }, { x: 50, y: 5 }],
]) {
  const d = endDirection(a, b)
  const p = assertOrthogonal(orthPath(a, b))
  const [x0, y0] = p[p.length - 2]
  const [x1, y1] = p[p.length - 1]
  const seg = { x: Math.sign(x1 - x0), y: Math.sign(y1 - y0) }
  assert.deepEqual(
    { x: d.x, y: d.y },
    { x: seg.x || d.x, y: seg.y || 0 },
    `arrowhead follows the final segment for ${JSON.stringify(b)}`
  )
}

// Vertical-only route ends going down — head must not default to horizontal.
assert.deepEqual(endDirection({ x: 7, y: 0 }, { x: 7, y: 40 }), { x: 0, y: 1 }, 'downward head')

// ── lead-out: the line must leave AWAY from its own component ───────────────
// The probe button sits INSIDE the header, so a route that turned immediately
// ran back across the card it belongs to. The exit stub has to clear the box.
{
  const box = { x: 100, y: 100, w: 300, h: 200 }
  const origin = { x: 120, y: 114 } // probe 0's centre in that header
  const L = box.x
  const R = box.x + box.w

  for (const [name, target, wantDir] of [
    ['below', { x: 260, y: 420 }, -1],
    ['far right', { x: 700, y: 300 }, 1],
    ['left', { x: 20, y: 400 }, -1],
    ['straight down', { x: 120, y: 500 }, -1],
    ['above', { x: 250, y: 20 }, -1],
  ]) {
    const d = leadDirection(box, origin, target)
    const lead = d * leadDistance(box, origin, d)
    const p = assertOrthogonal(orthPath(origin, target, lead))

    assert.equal(Math.sign(p[1][0] - p[0][0]), wantDir, `${name}: exits the right way`)
    // The whole point: the turn happens OUTSIDE the component.
    const stub = p[1][0]
    assert.ok(stub <= L || stub >= R, `${name}: turn at x=${stub} must clear ${L}..${R}`)
    assert.deepEqual(p[p.length - 1], [target.x, target.y], `${name}: reaches the target`)

    // The arrowhead must still match the real final segment.
    const a2 = p[p.length - 2]
    const b2 = p[p.length - 1]
    const expected =
      Math.abs(b2[0] - a2[0]) >= Math.abs(b2[1] - a2[1])
        ? { x: Math.sign(b2[0] - a2[0]) || 1, y: 0 }
        : { x: 0, y: Math.sign(b2[1] - a2[1]) || 1 }
    assert.deepEqual(endDirection(origin, target, lead), expected, `${name}: arrowhead`)
  }
}

console.log('probes: all checks passed')
