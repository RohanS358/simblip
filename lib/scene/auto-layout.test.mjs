// Placement decided by geometry instead of by the model.
//
// A language model cannot see the page. Asked for a pendulum it emits
// x:320, y:100 because numbers like that appeared in the corpus — not because
// it measured anything. It does not know the board is scrolled to y=1600,
// that a note already occupies the space, or that this is a 960x540 slide.
// Prompting cannot fix that: the information is geometric.
//
// So the script's coordinates are treated as a LAYOUT (the shape of the
// scene, which the model IS good at) and this decides the LOCATION. Every
// function is pure and total, which is why this file can test the real
// decisions rather than mocking them.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-layout-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')
writeFileSync(entry, `
export { planPlacement, findFreeSpot, fitToBounds, centreIn, unionRect } from '@/lib/scene/auto-layout'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })
const { planPlacement, findFreeSpot, fitToBounds, centreIn, unionRect } = await import(bundle)

const r = (x, y, w, h) => ({ x, y, w, h })
const B = (l, t, rr, b) => ({ left: l, top: t, right: rr, bottom: b })

/** Apply a placement to a scene, the way applySceneLayout does. */
const place = (scene, p) => {
  const box = unionRect(scene)
  return scene.map((s) => ({
    x: box.x + (s.x - box.x) * p.scale + p.dx,
    y: box.y + (s.y - box.y) * p.scale + p.dy,
    w: s.w * p.scale,
    h: s.h * p.scale,
  }))
}
const inside = (rect, b) =>
  rect.x >= b.left - 0.01 && rect.y >= b.top - 0.01 &&
  rect.x + rect.w <= b.right + 0.01 && rect.y + rect.h <= b.bottom + 0.01
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

// ── The core promise ────────────────────────────────────────────────────────

test('a scene on an empty page is centred in the visible area', () => {
  // The model's coordinates are irrelevant — this is the case it always got
  // wrong, emitting corpus numbers regardless of where the user is looking.
  const scene = [r(0, 0, 200, 100), r(220, 0, 100, 100)]
  const bounds = B(-1200, 1400, 200, 2000)
  const out = place(scene, planPlacement({ scene, occupied: [], bounds, fixedFrame: false }))
  const box = unionRect(out)
  assert.ok(Math.abs(box.x + box.w / 2 - (-500)) < 1, `centre x was ${box.x + box.w / 2}`)
  assert.ok(Math.abs(box.y + box.h / 2 - 1700) < 1, `centre y was ${box.y + box.h / 2}`)
})

test('a generated scene never lands on existing content', () => {
  const occupied = [r(0, 0, 400, 300)]
  const scene = [r(50, 50, 200, 200)] // squarely on top of it
  const bounds = B(0, 0, 1200, 800)
  const out = place(scene, planPlacement({ scene, occupied, bounds, fixedFrame: false }))
  for (const o of out) for (const b of occupied) assert.ok(!hit(o, b), 'scene overlaps existing content')
})

test('a scene that already fits is not moved at all', () => {
  // Gratuitous movement is its own bug: a script that positioned things
  // deliberately must be respected.
  const occupied = [r(0, 0, 100, 100)]
  const scene = [r(500, 500, 100, 100)]
  const p = planPlacement({ scene, occupied, bounds: B(0, 0, 1200, 800), fixedFrame: false })
  assert.deepEqual(p, { dx: 0, dy: 0, scale: 1 })
})

test('a scene is kept inside a slide frame', () => {
  // Content outside a slide is invisible in Present mode and lost on export.
  const scene = [r(700, 400, 600, 400)] // hangs off the bottom-right
  const bounds = B(0, 0, 960, 540)
  const out = place(scene, planPlacement({ scene, occupied: [], bounds, fixedFrame: true }))
  for (const o of out) assert.ok(inside(o, bounds), `${JSON.stringify(o)} escaped the slide`)
})

test('a scene larger than the frame is scaled down uniformly, never stretched', () => {
  const scene = [r(0, 0, 1920, 1080)]
  const bounds = B(0, 0, 960, 540)
  const p = planPlacement({ scene, occupied: [], bounds, fixedFrame: true })
  assert.ok(p.scale < 1, 'must scale to fit')
  const out = place(scene, p)
  assert.ok(inside(out[0], bounds))
  // Uniform: the aspect ratio survives, so a circle stays a circle and a
  // hinge stays on the rod it pins.
  assert.ok(Math.abs(out[0].w / out[0].h - 1920 / 1080) < 0.01)
})

test('a scene is never scaled UP to fill a frame', () => {
  const scene = [r(0, 0, 100, 100)]
  const p = planPlacement({ scene, occupied: [], bounds: B(0, 0, 960, 540), fixedFrame: true })
  assert.equal(p.scale, 1)
})

test('relative geometry survives placement exactly', () => {
  // This is what makes a simulation work: a spring's endpoints are bound to
  // the bodies they touch, so every part must move by the SAME vector.
  const scene = [r(300, 80, 40, 40), r(300, 320, 60, 60), r(300, 120, 10, 200)]
  const p = planPlacement({ scene, occupied: [r(0, 0, 2000, 2000)], bounds: B(0, 0, 3000, 3000), fixedFrame: false })
  const out = place(scene, p)
  for (let i = 1; i < scene.length; i++) {
    assert.ok(Math.abs((out[i].x - out[0].x) - (scene[i].x - scene[0].x)) < 0.01, 'x spacing changed')
    assert.ok(Math.abs((out[i].y - out[0].y) - (scene[i].y - scene[0].y)) < 0.01, 'y spacing changed')
  }
})

test('a board scene overflowing the viewport is allowed to, a slide is not', () => {
  const scene = [r(0, 0, 2000, 200)]
  const bounds = B(0, 0, 960, 540)
  assert.equal(planPlacement({ scene, occupied: [], bounds, fixedFrame: false }).scale, 1,
    'a board scrolls, so a wide scene is fine')
  assert.ok(planPlacement({ scene, occupied: [], bounds, fixedFrame: true }).scale < 1,
    'a slide cannot scroll, so it must fit')
})

// ── The pieces ──────────────────────────────────────────────────────────────

test('unionRect is the true footprint of a scene', () => {
  assert.deepEqual(unionRect([r(10, 20, 30, 40), r(100, 0, 10, 10)]), { x: 10, y: 0, w: 100, h: 60 })
  assert.equal(unionRect([]), null)
})

test('centreIn puts a scene in the middle of any bounds', () => {
  const d = centreIn(r(0, 0, 100, 100), B(0, 0, 500, 500))
  assert.deepEqual(d, { dx: 200, dy: 200 })
})

test('findFreeSpot takes the smallest FORWARD move that clears', () => {
  // A page grows right and down, so clearing a blocker should never push the
  // scene up or left when a forward move is available.
  const blocker = r(0, 0, 200, 100)
  const spot = findFreeSpot(r(0, 0, 100, 100), [blocker], B(-2000, -2000, 2000, 2000))
  assert.ok(spot.dx >= 0 && spot.dy >= 0, `moved backward: ${JSON.stringify(spot)}`)
  assert.ok(spot.dx > 0 || spot.dy > 0, 'it must actually move')
  // And it clears: down past the blocker (124) beats right past it (224).
  const moved = { x: spot.dx, y: spot.dy, w: 100, h: 100 }
  assert.ok(!hit(moved, blocker), 'still overlapping')
  assert.ok(Math.hypot(spot.dx, spot.dy) < 300, 'should not fly across the page')
})

test('fitToBounds slides before it scales', () => {
  // A scene that merely hangs off an edge should move back, not shrink.
  const f = fitToBounds(r(900, 0, 200, 200), B(0, 0, 960, 540))
  assert.equal(f.scale, 1, 'it fits — no scaling needed')
  assert.ok(f.dx < 0, 'it should slide back inside')
})

test('placement is deterministic', () => {
  // Same input, same output — no randomness, no model call.
  const args = { scene: [r(5, 5, 100, 100)], occupied: [r(0, 0, 200, 200)], bounds: B(0, 0, 800, 600), fixedFrame: true }
  const a = planPlacement(args)
  for (let i = 0; i < 5; i++) assert.deepEqual(planPlacement(args), a)
})

test('an empty scene is a no-op, not a crash', () => {
  assert.deepEqual(planPlacement({ scene: [], occupied: [], bounds: B(0, 0, 100, 100), fixedFrame: true }),
    { dx: 0, dy: 0, scale: 1 })
})

test('a full page still yields a usable spot rather than giving up', () => {
  const occupied = Array.from({ length: 20 }, (_, i) => r(0, i * 100, 900, 100))
  const scene = [r(0, 0, 200, 200)]
  const out = place(scene, planPlacement({ scene, occupied, bounds: B(0, 0, 960, 2000), fixedFrame: false }))
  for (const b of occupied) assert.ok(!hit(out[0], b), 'must still find clear space')
})
