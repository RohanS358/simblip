// Run: node --test lib/scene/scribble.test.mjs
//
// Synthetic scribbles stand in for hands: a zigzag scratch-out at several
// densities and zooms must be recognised; things that merely resemble one
// (a circle, a sine wave, a resistor zigzag) must not; and what gets erased
// is what the scratch actually covers.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'scribble-'))
const entry = join(dir, 'e.ts')
const out = join(dir, 'o.mjs')
writeFileSync(entry, `export { isScribble, scribbleVictims, scribbleShape } from '@/lib/scene/scribble'\nexport { componentById, fromRecognition, baseObject } from '@/lib/scene/factory'`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`, '--external:react', '--external:zustand'],
  { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
const m = await import(pathToFileURL(out).href)
test.after(() => rmSync(dir, { recursive: true, force: true }))

// Deterministic jitter — a real hand never draws a perfect line.
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5

/** A back-and-forth scratch across a w×h box with `passes` strokes, sampled
 *  every `every` px along the path, jittered by ±`jit` px. */
function zigzag({ x = 0, y = 0, w = 120, h = 60, passes = 9, every = 3, jit = 1.5 } = {}) {
  const corners = []
  for (let i = 0; i < passes; i++) corners.push([x + (i % 2 ? w : 0), y + (h * i) / (passes - 1)])
  return resample(corners, every, jit)
}

function resample(corners, every, jit) {
  const pts = []
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]
    const [bx, by] = corners[i]
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / every))
    for (let j = 0; j < n; j++) pts.push([ax + ((bx - ax) * j) / n + rnd() * jit, ay + ((by - ay) * j) / n + rnd() * jit, 0.5])
  }
  pts.push([...corners[corners.length - 1], 0.5])
  return pts
}

/** `loops` overlapping circles drifting right, like a coil scribble. */
function coil({ loops = 4, r = 25, every = 3 } = {}) {
  const pts = []
  const steps = Math.round((2 * Math.PI * r) / every)
  for (let l = 0; l < loops; l++) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI
      pts.push([r + l * 12 + r * Math.cos(a) + rnd(), r + r * Math.sin(a) + rnd(), 0.5])
    }
  }
  return pts
}

const SENS = 0.5

test('a dense zigzag scratch is a scribble', () => {
  assert.equal(m.isScribble(zigzag(), SENS, 1), true)
})

test('a FAST scribble — few samples per pass — is still a scribble', () => {
  // The old detector wanted dozens of samples; a quick scratch delivers ~15.
  const pts = zigzag({ every: 40, jit: 2 })
  assert.ok(pts.length < 30, `only ${pts.length} samples`)
  assert.equal(m.isScribble(pts, SENS, 1), true)
})

test('a small tight scratch counts', () => {
  assert.equal(m.isScribble(zigzag({ w: 40, h: 24, passes: 9, every: 2, jit: 1 }), SENS, 1), true)
})

test('a coil scribble counts', () => {
  assert.equal(m.isScribble(coil(), SENS, 1), true)
})

test('shape, not zoom, decides: same scratch at 0.5× and 2×', () => {
  const page = zigzag({ w: 240, h: 120, every: 6, jit: 3 })
  assert.equal(m.isScribble(page, SENS, 0.5), true) // 120×60 on screen
  const small = page.map(([x, y, p]) => [x / 4, y / 4, p]) // 60×30 page px …
  assert.equal(m.isScribble(small, SENS, 2), true) //        … 120×60 on screen
})

test('things that are NOT scribbles', () => {
  const circle = Array.from({ length: 60 }, (_, i) => [50 + 40 * Math.cos(i / 9.5), 50 + 40 * Math.sin(i / 9.5), 0.5])
  assert.equal(m.isScribble(circle, SENS, 1), false, 'a circle')

  const line = Array.from({ length: 80 }, (_, i) => [i * 3, 20 + rnd() * 2, 0.5])
  assert.equal(m.isScribble(line, SENS, 1), false, 'a wobbly line')

  const sine = Array.from({ length: 120 }, (_, i) => [i * 2, 20 * Math.sin(i / 6), 0.5])
  assert.equal(m.isScribble(sine, SENS, 1), false, 'a wave / handwriting loop-less cursive')

  // The zigzag symbol for a resistor: 6 sharp turns but barely doubled back.
  const resistor = resample([[0, 10], [10, 10], [14, 0], [22, 20], [30, 0], [38, 20], [46, 0], [54, 20], [58, 10], [70, 10]], 2, 0.6)
  assert.equal(m.isScribble(resistor, SENS, 1), false, 'a resistor symbol')

  assert.equal(m.isScribble([[0, 0], [1, 1]], SENS, 1), false, 'a dot')
  assert.equal(m.isScribble([], SENS, 1), false, 'nothing')
})

test('sensitivity moves the bar', () => {
  const modest = zigzag({ passes: 5, every: 4 }) // three reversals — a quick scratch
  assert.equal(m.isScribble(modest, 1, 1), true, 'high: a quick zigzag is enough')
  assert.equal(m.isScribble(modest, 0, 1), false, 'low: must scribble hard')
  const hard = zigzag({ passes: 13, every: 4 })
  assert.equal(m.isScribble(hard, 0, 1), true, 'low still allows a furious one')
})

// ── what gets erased ──────────────────────────────────────────────────────

const ink = (pts, z = 1) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  const o = m.fromRecognition({
    kind: 'stroke', points: pts.map(([px, py]) => [px - x, py - y, 0.5]), x, y,
    w: Math.max(Math.max(...xs) - x, 1), h: Math.max(Math.max(...ys) - y, 1),
  })
  o.z = z
  return o
}
const part = (id, x, y) => m.componentById(id).create({ x, y })
const byId = (...os) => Object.fromEntries(os.map((o) => [o.id, o]))

const SCRATCH = () => zigzag({ x: 100, y: 100, w: 120, h: 60 })

test('ink under the scratch goes; ink elsewhere stays', () => {
  const under = ink([[110, 130], [210, 135]])
  const far = ink([[400, 130], [500, 135]])
  assert.deepEqual(m.scribbleVictims(byId(under, far), SCRATCH(), 1), [under.id])
})

test('a part scratched through the middle goes', () => {
  const r = part('resistor', 124, 106) // 96×48 box inside the scratch
  assert.deepEqual(m.scribbleVictims(byId(r), SCRATCH(), 1), [r.id])
})

test('a part the scratch only brushes survives', () => {
  const r = part('resistor', 205, 100) // only its left edge is under the scratch
  assert.deepEqual(m.scribbleVictims(byId(r), SCRATCH(), 1), [])
})

test('scratching a corner of a big object does not delete it', () => {
  const table = m.baseObject('rect', { x: 100, y: 100 })
  table.size = { w: 380, h: 260 }
  assert.deepEqual(m.scribbleVictims(byId(table), SCRATCH(), 1), [])
})

test('a long line only partly scratched survives; mostly scratched goes', () => {
  const long = ink([[100, 130], [600, 130]]) // ~24 % under the scratch
  assert.deepEqual(m.scribbleVictims(byId(long), SCRATCH(), 1), [])
  const mostly = ink([[100, 130], [260, 130]]) // ~75 %
  assert.deepEqual(m.scribbleVictims(byId(mostly), SCRATCH(), 1), [mostly.id])
})

test('locked and system objects are never erased', () => {
  const locked = part('resistor', 124, 106)
  locked.metadata.locked = true
  assert.deepEqual(m.scribbleVictims(byId(locked), SCRATCH(), 1), [])
  const sys = m.baseObject('rect', { x: 100, y: 100 })
  sys.size = { w: 380, h: 260 }
  sys.metadata.render = 'system'
  assert.deepEqual(m.scribbleVictims(byId(sys), SCRATCH(), 1), [])
})

test('a loose scratch with wide gaps still reaches the ink between its stripes', () => {
  const loose = zigzag({ x: 100, y: 100, w: 160, h: 90, passes: 4, every: 6 }) // ~30 px between stripes
  const word = ink([[110, 140], [250, 150]])
  assert.deepEqual(m.scribbleVictims(byId(word), loose, 1), [word.id])
})

test('works at any zoom', () => {
  const under = ink([[110, 130], [210, 135]])
  for (const zoom of [0.25, 0.5, 2, 4]) {
    const scratch = SCRATCH().map(([x, y, p]) => [x, y, p])
    assert.deepEqual(m.scribbleVictims(byId(under), scratch, zoom), [under.id], `zoom ${zoom}`)
  }
})
