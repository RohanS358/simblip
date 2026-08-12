// Regression test: connectors must stay ORTHOGONAL when an anchored endpoint
// moves. They used to straighten into a diagonal, because bends are stored
// object-local and reprojectConnectors moved the connector's origin without
// rebasing them (lib/store/document.ts).
//
// No test framework in this project — run it directly:
//   node lib/render/connector-path.test.mjs
//
// The pure geometry is duplicated here rather than imported (the source is a
// TS module). Keep in sync with connectorPoints / refitBends.

import assert from 'node:assert/strict'

const connectorPoints = (a, bends, b) => [a, ...(bends.length > 0 ? bends : [[b[0], a[1]]]), b]

const refitBends = (a, bends, b) => {
  if (bends.length === 0) return bends
  const out = bends.map((p) => [p[0], p[1]])
  for (let i = 0; i < out.length; i++) {
    const prev = i === 0 ? a : out[i - 1]
    const next = i === out.length - 1 ? b : out[i + 1]
    const wasVerticalIn = Math.abs(bends[i][0] - (i === 0 ? a[0] : bends[i - 1][0])) < 0.5
    if (wasVerticalIn) {
      out[i][0] = prev[0]
      out[i][1] = next[1]
    } else {
      out[i][1] = prev[1]
      out[i][0] = next[0]
    }
  }
  return out
}

/** Every segment must be axis-aligned — that's what "orthogonal" means here. */
function assertOrthogonal(pts, what) {
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0])
    const dy = Math.abs(pts[i][1] - pts[i - 1][1])
    assert.ok(
      dx <= 0.5 || dy <= 0.5,
      `${what}: segment ${i} is diagonal (${JSON.stringify(pts)})`
    )
  }
}

/** Simulate what reprojectConnectors does when an endpoint moves. */
function moveEndpoint(a, b, oldPos, bends, newB) {
  const px = Math.min(a.x, newB.x)
  const py = Math.min(a.y, newB.y)
  const localA = [a.x - px, a.y - py]
  const localB = [newB.x - px, newB.y - py]
  const rebased = bends.map((p) => [p[0] + (oldPos.x - px), p[1] + (oldPos.y - py)])
  return {
    pts: connectorPoints(localA, refitBends(localA, rebased, localB), localB),
    localA,
    localB,
    origin: { x: px, y: py },
  }
}

// ── the original bug ────────────────────────────────────────────────────────
// (100,100)→(300,200) bending at (100,200); the end object moves to (250,60).
// Before the fix this rendered (100,100)→(100,160)→(250,60): a diagonal.
{
  const r = moveEndpoint(
    { x: 100, y: 100 },
    { x: 300, y: 200 },
    { x: 100, y: 100 },
    [[0, 100]],
    { x: 250, y: 60 }
  )
  assertOrthogonal(r.pts, 'vertical-first after move')
  const world = r.pts.map((p) => [p[0] + r.origin.x, p[1] + r.origin.y])
  assert.deepEqual(world[0], [100, 100], 'start stays on its anchor')
  assert.deepEqual(world[world.length - 1], [250, 60], 'end lands on the moved anchor')
}

// ── shape preservation ──────────────────────────────────────────────────────
// A route drawn "along x, then y" must not flip to "along y, then x".
{
  const a = [0, 0]
  const b = [140, 260]
  const pts = connectorPoints(a, refitBends(a, [[200, 0]], b), b)
  assertOrthogonal(pts, 'horizontal-first')
  assert.equal(pts[1][1], a[1], 'first segment is still horizontal')
}
{
  const a = [0, 0]
  const b = [140, 260]
  const pts = connectorPoints(a, refitBends(a, [[0, 100]], b), b)
  assertOrthogonal(pts, 'vertical-first')
  assert.equal(pts[1][0], a[0], 'first segment is still vertical')
}

// ── multi-bend routes ───────────────────────────────────────────────────────
{
  const a = [0, 0]
  const b = [260, 340]
  const refit = refitBends(a, [[150, 0], [150, 200]], b)
  assertOrthogonal(connectorPoints(a, refit, b), 'two-bend Z')
  assert.equal(refit.length, 2, 'bends are never invented or dropped')
}

// ── degenerate cases ────────────────────────────────────────────────────────
assert.deepEqual(refitBends([0, 0], [], [10, 10]), [], 'no bends → unchanged')
assertOrthogonal(connectorPoints([0, 0], [], [10, 10]), 'default corner')

// An endpoint that does not move must leave the route exactly as it was.
{
  const a = [0, 0]
  const b = [200, 100]
  const bends = [[0, 100]]
  assert.deepEqual(refitBends(a, bends, b), bends, 'no-op move changes nothing')
}

console.log('connector-path: all checks passed')
