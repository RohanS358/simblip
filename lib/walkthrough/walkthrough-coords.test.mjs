import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * The walkthrough places objects at the exact point the cursor flew to, which
 * only works if screen→canvas and canvas→screen are true inverses under pan,
 * zoom, and an ancestor transform:scale. Getting this wrong is what made
 * objects appear away from the pointer, so it is worth pinning down.
 *
 * These mirror the bodies of screenToCanvas / canvasToScreen in
 * walkthrough-cursor-driver.ts (which import browser-only modules).
 */

const screenToCanvas = (rect, s, vp, p) => ({
  x: ((p.x - rect.left) / s - vp.x) / vp.zoom,
  y: ((p.y - rect.top) / s - vp.y) / vp.zoom,
})

const canvasToScreen = (rect, s, vp, p) => ({
  x: rect.left + (p.x * vp.zoom + vp.x) * s,
  y: rect.top + (p.y * vp.zoom + vp.y) * s,
})

const rect = { left: 329, top: 48 } // the real canvas origin on a 1440×900 board

test('screen→canvas→screen round-trips at zoom 1, no pan', () => {
  const vp = { x: 0, y: 0, zoom: 1 }
  const p = { x: 700, y: 400 }
  const back = canvasToScreen(rect, 1, vp, screenToCanvas(rect, 1, vp, p))
  assert.ok(Math.abs(back.x - p.x) < 1e-9)
  assert.ok(Math.abs(back.y - p.y) < 1e-9)
})

test('round-trips under pan and zoom', () => {
  const vp = { x: -240, y: 130, zoom: 1.75 }
  const p = { x: 1012, y: 622 }
  const back = canvasToScreen(rect, 1, vp, screenToCanvas(rect, 1, vp, p))
  assert.ok(Math.abs(back.x - p.x) < 1e-9)
  assert.ok(Math.abs(back.y - p.y) < 1e-9)
})

test('round-trips under an ancestor stage scale', () => {
  const vp = { x: 60, y: -30, zoom: 0.8 }
  const p = { x: 880, y: 300 }
  const back = canvasToScreen(rect, 1.25, vp, screenToCanvas(rect, 1.25, vp, p))
  assert.ok(Math.abs(back.x - p.x) < 1e-9)
  assert.ok(Math.abs(back.y - p.y) < 1e-9)
})

test('the canvas origin maps to page (0,0) when unpanned', () => {
  const vp = { x: 0, y: 0, zoom: 1 }
  const o = screenToCanvas(rect, 1, vp, { x: rect.left, y: rect.top })
  assert.equal(o.x, 0)
  assert.equal(o.y, 0)
})
