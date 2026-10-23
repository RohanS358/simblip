// S5: the photo path. Pictures are SYNTHETIC (generated ink rendered to pixels and spoiled like a phone photo);
// nothing here says how well real photographs read.
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test --test-force-exit lib/sketch/photo/photo.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSketchNet } from '../sketchnet.ts'
import { photoToInk, readPhoto } from './index.ts'
import { despeckle, threshold, thin, toGrey, downscale, countInk } from './raster.ts'
import { traceStrokes } from './trace.ts'
import { renderPhoto } from './synth-photo.ts'
import { makeBudget, PhotoRefused, MAX_LINE_PIECES } from './budget.ts'
import { drawScene } from '../scene-synth.ts'
import { makeWriter } from '../synth.ts'
import { makeRng } from '../rng.ts'

const root = resolve(import.meta.dirname, '../../..')
const load = (n) => {
  const b = readFileSync(resolve(root, `public/models/${n}.bin`))
  return createSketchNet(JSON.parse(readFileSync(resolve(root, `public/models/${n}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
const net = load('sketchnet-v1')
const charNet = load('inkchars-v1')
const { layouts } = JSON.parse(readFileSync(resolve(root, 'lib/sketch/golden/scene-layouts.json'), 'utf8'))

const solid = (w, h, v) => ({ data: new Uint8ClampedArray(w * h * 4).fill(v), width: w, height: h })
const photoOf = (i, o = {}) => {
  const rng = makeRng(900 + i)
  const sc = drawScene(layouts[i], rng.fork('s'), makeWriter(rng.fork('w'), `ph-${i}`, 'pen'), undefined, undefined, { text: false })
  return { sc, img: renderPhoto(sc.strokes, rng.fork('p'), { width: 2, blur: 1, shade: 0.12, noise: 4, ...o }) }
}

test('thinning leaves a 1-pixel line, in the middle of a thick one', () => {
  const w = 60, h = 30
  const px = new Uint8Array(w * h)
  for (let y = 12; y < 17; y++) for (let x = 5; x < 55; x++) px[y * w + x] = 1 // a 5 px bar
  const m = { w, h, px }
  thin(m)
  const rows = new Set()
  for (let y = 0; y < h; y++) for (let x = 10; x < 50; x++) if (px[y * w + x]) rows.add(y)
  assert.ok(rows.size <= 2, `thinned to ${rows.size} rows`)
  assert.ok([...rows].every((y) => y >= 13 && y <= 15), 'near the centre')
})

test('the threshold follows the local light: a shaded corner of a page still gives the line', () => {
  const w = 80, h = 60
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 235 * (1 - 0.45 * (x / w)) // paper darkens to the right
  for (let x = 10; x < 70; x++) { g[30 * w + x] -= 120; g[31 * w + x] -= 120 }
  const m = threshold(g, w, h)
  const ink = countInk(m)
  assert.ok(ink >= 100 && ink <= 400, `ink pixels ${ink}`)
  assert.equal(m.px[5 * w + 5], 0, 'plain shaded paper is not ink')
  assert.equal(m.px[5 * w + 70], 0)
})

test('specks of dust are dropped, lines are kept', () => {
  const w = 40, h = 40
  const m = { w, h, px: new Uint8Array(w * h) }
  m.px[5 * w + 5] = 1
  for (let x = 5; x < 35; x++) m.px[20 * w + x] = 1
  assert.equal(despeckle(m, 6), 1)
  assert.equal(m.px[5 * w + 5], 0)
  assert.equal(m.px[20 * w + 20], 1)
})

test('a drawn rectangle with a gap comes back as strokes that together follow it', () => {
  const sc = { strokes: [[[20, 20], [200, 20], [200, 120], [20, 120], [20, 20]]] }
  const img = renderPhoto(sc.strokes, makeRng(1), { width: 3, blur: 1, noise: 0 })
  const r = photoToInk(img)
  assert.ok('ink' in r, JSON.stringify(r))
  const len = r.ink.strokes.reduce((a, s) => a + s.pts.slice(1).reduce((b, p, i) => b + Math.hypot(p[0] - s.pts[i][0], p[1] - s.pts[i][1]), 0), 0)
  const back = len / r.ink.scale // strokes are in working pixels (a small picture is enlarged before tracing)
  assert.ok(back > 0.9 * 560 && back < 1.3 * 560, `traced length ${Math.round(back)} of 560`)
})

test('blank, black, tiny and noisy pictures are refused with words that say what to do', () => {
  const blank = photoToInk(solid(200, 150, 240))
  assert.ok('error' in blank)
  assert.match(blank.error, /could not find any drawing/)
  const black = photoToInk(solid(200, 150, 10))
  assert.ok('error' in black)
  const tiny = photoToInk(solid(10, 10, 240))
  assert.ok('error' in tiny)
  assert.match(tiny.error, /too small/)
  // through the reader too: a failure, never a throw
  const r = readPhoto(solid(200, 150, 240), net, charNet)
  assert.ok('error' in r)
})

test('a photographed circuit is read into parts and wiring, with the same reader as ink', () => {
  const { img, sc } = photoOf(0)
  const r = readPhoto(img, net, charNet)
  assert.ok(!('error' in r), JSON.stringify(r))
  assert.equal(r.result.kind, 'circuit')
  const parts = r.result.ghost.result.parts
  assert.ok(parts.length >= sc.truth.nodes.length - 1, `parts ${parts.length} of ${sc.truth.nodes.length}`)
  assert.ok(r.result.ghost.result.ir.edges.length >= 1, 'wired')
})

test('placement: the reading lands on the picture it came from', () => {
  const { img } = photoOf(0)
  const r = readPhoto(img, net, charNet, 'p', { x: 1000, y: 2000, k: 0.5 })
  assert.ok(!('error' in r))
  assert.equal(r.result.kind, 'circuit')
  for (const p of r.result.ghost.result.parts) {
    assert.ok(p.box.x0 >= 990 && p.box.x1 <= 1000 + 0.5 * img.width + 10, `x ${p.box.x0}..${p.box.x1}`)
    assert.ok(p.box.y0 >= 1990 && p.box.y1 <= 2000 + 0.5 * img.height + 10, `y ${p.box.y0}..${p.box.y1}`)
  }
})

test('SYNTHETIC photo benchmark: circuits are found, most parts located, and the numbers are reported not hidden', (t) => {
  let n = 0, circuits = 0, located = 0, truthParts = 0, classRight = 0
  for (let i = 0; i < layouts.length; i += 2) {
    const { img, sc } = photoOf(i)
    const r = readPhoto(img, net, charNet)
    n++
    truthParts += sc.truth.nodes.length
    if ('error' in r || r.result.kind !== 'circuit') continue
    circuits++
    const got = r.result.ghost.result.parts
    const mapped = got.map((p) => ({ cls: p.cls, cx: (p.box.x0 + p.box.x1) / 2 / r.ink.scale - img.shiftX, cy: (p.box.y0 + p.box.y1) / 2 / r.ink.scale - img.shiftY }))
    for (const nd of sc.truth.nodes) {
      const tx = nd.bbox[0] + nd.bbox[2] / 2, ty = nd.bbox[1] + nd.bbox[3] / 2
      const hit = mapped.find((q) => Math.hypot(q.cx - tx, q.cy - ty) <= 0.75 * Math.hypot(nd.bbox[2], nd.bbox[3]) + 12)
      if (hit) { located++; if (hit.cls === nd.cls) classRight++ }
    }
  }
  t.diagnostic(`SYNTHETIC photos: ${circuits}/${n} read as circuits; parts located ${located}/${truthParts}, class right ${classRight}/${located}`)
  assert.ok(circuits >= 0.85 * n, `read as circuits ${circuits}/${n}`)
  assert.ok(located >= 0.8 * truthParts, `located ${located}/${truthParts}`)
  assert.ok(classRight >= 0.6 * located, `class right ${classRight}/${located}`)
})

// ── limits: the audit finding "a photo of graph paper took minutes and then froze the page" ────────────────

const gridPaper = (w, h, step) => {
  const d = new Uint8ClampedArray(w * h * 4).fill(240)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x % step === 0 || y % step === 0) { const i = 4 * (y * w + x); d[i] = d[i + 1] = d[i + 2] = 40 }
  return { data: d, width: w, height: h }
}

test('graph paper is refused quickly with words that say what to do (it took 18 s to minutes before)', () => {
  for (const [w, h, step] of [[400, 300, 12], [800, 600, 12], [1600, 1100, 40], [1800, 1200, 8]]) {
    const t0 = performance.now()
    const r = photoToInk(gridPaper(w, h, step))
    const ms = performance.now() - t0
    assert.ok('error' in r, `${w}x${h} step ${step} must be refused`)
    assert.match(r.error, /far more lines than a circuit diagram|too busy/)
    assert.ok(ms < 5000, `${w}x${h}: refused in ${Math.round(ms)} ms`)
  }
})

test('a page of tiny scribble (hundreds of short strokes) is refused, not traced for minutes', () => {
  const rng = makeRng(5)
  const strokes = []
  for (let i = 0; i < 700; i++) {
    const x = (i % 35) * 24, y = Math.floor(i / 35) * 24
    strokes.push(Array.from({ length: 6 }, (_, k) => [x + k * 3 + rng.range(-1, 1), y + rng.range(0, 14)]))
  }
  const t0 = performance.now()
  const r = photoToInk(renderPhoto(strokes, rng, { width: 2, blur: 0 }))
  assert.ok(performance.now() - t0 < 8000)
  assert.ok('error' in r || r.ink.strokes.length <= 300, 'either refused or within the stroke cap')
})

test('a deadline stops the work at the next check and says so; it never throws a raw error', () => {
  let t = 0
  const b = makeBudget(1000, () => t)
  for (let i = 0; i < 200; i++) b.check() // the clock has not moved
  t = 5000
  assert.throws(() => { for (let i = 0; i < 64; i++) b.check() }, (e) => e instanceof PhotoRefused && /too busy/.test(e.message))
  // through the public entry point: a 1 ms budget on a real circuit comes back as a refusal
  const { img } = photoOf(0)
  const r = photoToInk(img, { budgetMs: 0 })
  assert.ok('error' in r || 'ink' in r, 'an answer, not an exception')
})

test('the joiner still puts a zigzag back together (fragments at the tips) and keeps wires apart from symbols', () => {
  const zig = [[0, 100]]
  for (let k = 0; k < 6; k++) zig.push([30 + k * 36, k % 2 ? 100 + 28 : 100 - 28])
  zig.push([260, 100])
  const wires = [[[-200, 100], [0, 100]], [[260, 100], [460, 100]]]
  const r = photoToInk(renderPhoto([zig, ...wires], makeRng(2), { width: 3, blur: 1, margin: 40 }))
  assert.ok('ink' in r, JSON.stringify(r))
  // wire, zigzag, wire: a handful of strokes, not one per tooth
  assert.ok(r.ink.strokes.length <= 8, `strokes ${r.ink.strokes.length}`)
  assert.ok(r.ink.strokes.some((s) => s.pts.length >= 6), 'the zigzag stayed one stroke')
})

test('the line-piece cap is a real number a normal diagram stays far below', () => {
  const { img } = photoOf(8) // the largest layout
  const r = photoToInk(img)
  assert.ok('ink' in r)
  assert.ok(r.ink.strokes.length < MAX_LINE_PIECES / 4, `strokes ${r.ink.strokes.length}`)
})

void toGrey
void downscale
void traceStrokes
