import assert from 'node:assert/strict'
import { finalizeOrtho } from './ortho.ts'

// L route, end snapped off-axis → last segment stays horizontal
let r = finalizeOrtho([[0, 0], [100, 2], [100, 60]], null, [103, 64])
assert.deepEqual(r, [[0, 0], [103, 0], [103, 64]])
// straight run, both ends snapped off-axis → elbow inserted, every segment axis-aligned
r = finalizeOrtho([[0, 0], [100, 0]], [0, 0], [100, 9])
for (let i = 1; i < r.length; i++) assert.ok(r[i][0] === r[i - 1][0] || r[i][1] === r[i - 1][1])
assert.deepEqual(r[r.length - 1], [100, 9])
console.log('ortho ok')
