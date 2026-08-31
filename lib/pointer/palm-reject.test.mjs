// Palm vs fingertip classification, both flavours. The trap is the unit
// mismatch: Touch.radiusX is a RADIUS, PointerEvent.width is a DIAMETER, and
// both are compared against the same user-facing radius setting. Getting that
// wrong makes every fingertip read as a palm (or no palm ever pan).
//
// Run directly:  node lib/pointer/palm-reject.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./palm-reject.ts', import.meta.url), 'utf8')
const js = src
  .replace(/export function/g, 'function')
  // Casts first — stripping type annotations inside them leaves a bare `as`.
  .replace(/\(touch as unknown as \{ radiusX\?: number \}\)/, 'touch')
  .replace(/\(touch as unknown as \{ radiusY\?: number \}\)/, 'touch')
  .replace(/: Touch|: number|: boolean|: \{ width\?: number; height\?: number \}/g, '')
const { isPalmTouch, isPalmPointer } = await import(
  `data:text/javascript,${encodeURIComponent(js + '\nexport { isPalmTouch, isPalmPointer }')}`
)

const R = 20 // the default palmRejectRadiusPx

// Touch: radii compare directly.
assert.equal(isPalmTouch({ radiusX: 8, radiusY: 8 }, R), false, 'fingertip is not a palm')
assert.equal(isPalmTouch({ radiusX: 45, radiusY: 30 }, R), true, 'wide contact is a palm')
assert.equal(isPalmTouch({}, R), false, 'unmeasured touch defaults to fingertip')
assert.equal(isPalmTouch({ radiusX: 99, radiusY: 99 }, 0), false, 'radius 0 disables the check')

// Pointer: width/height are diameters, so the same physical contact must
// classify the same way as its Touch equivalent.
assert.equal(isPalmPointer({ width: 16, height: 16 }, R), false, 'r=8 fingertip is not a palm')
assert.equal(isPalmPointer({ width: 90, height: 60 }, R), true, 'r=45 palm is a palm')
assert.equal(isPalmPointer({ width: 1, height: 1 }, R), false, 'browsers reporting 1x1 read as fingertip')
assert.equal(isPalmPointer({}, R), false, 'unmeasured pointer defaults to fingertip')
assert.equal(isPalmPointer({ width: 200, height: 200 }, 0), false, 'radius 0 disables the check')

// The boundary itself: a 40px-wide pointer is exactly radius 20 — not yet a palm.
assert.equal(isPalmPointer({ width: 40, height: 40 }, R), false, 'exactly at the radius is not a palm')
assert.equal(isPalmPointer({ width: 41, height: 41 }, R), true, 'just past the radius is a palm')

console.log('palm-reject: ok')
