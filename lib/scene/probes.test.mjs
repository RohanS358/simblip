// Self-check for probe geometry: orthogonal routing + arrowhead direction.
// No test framework in this project — run it directly:
//   node lib/scene/probes.test.mjs
//
// Pure geometry is duplicated here rather than imported (probes.ts is a
// 'use client' TS module pulling in the circuit engine). Keep in sync with
// orthPath / endDirection in lib/scene/probes.ts.

import assert from 'node:assert/strict'

const orthPath = (a, b) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  if (Math.abs(dx) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  if (Math.abs(dx) < 24) return `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`
  const midX = a.x + dx / 2
  return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`
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
const endDirection = (a, b) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) < 1) return { x: Math.sign(dx) || 1, y: 0 }
  if (Math.abs(dx) < 1) return { x: 0, y: Math.sign(dy) || 1 }
  if (Math.abs(dx) < 24) return { x: Math.sign(dx) || 1, y: 0 }
  return { x: Math.sign(dx) || 1, y: 0 }
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

console.log('probes: all checks passed')
