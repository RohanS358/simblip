// Physics checks for the optics engine (lib/optics/engine.ts): every number
// here is a textbook result the tracer must reproduce, not a snapshot.
//
// Run: node --test lib/optics/optics.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-optics-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'optics.mjs')
writeFileSync(entry, `export * from '@/lib/optics/engine'\n`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`, `--alias:@=${root}`], {
  cwd: root,
  stdio: 'pipe',
})
const O = await import(bundle)

let id = 0
const obj = (kind, x, y, w, h, type, params = {}, extra = {}) => ({
  id: `o${id++}`,
  name: type,
  geometry: { kind, ...(extra.points ? { points: extra.points } : {}) },
  position: { x, y },
  size: { w, h },
  rotation: extra.rotation ?? 0,
  z: 0,
  behaviors: [
    {
      id: 'b',
      type,
      enabled: true,
      params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { kind: 'number', value: v }])),
    },
  ],
  parameters: {},
  metadata: {},
})
const source = (x, y, deg, params) => obj('circle', x - 12, y - 12, 24, 24, 'lightSource', { rays: 1, aperture: 0, ...params }, { rotation: deg })
const vline = (x, y0, y1, type, params) => obj('line', x, y0, 2, y1 - y0, type, params, { points: [[0, 0], [0, y1 - y0]] })
const dirOf = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}
const main = (rays) => rays.reduce((a, b) => (b.intensity > a.intensity ? b : a))

test('glass slab: the exit ray is parallel to the incident ray (Snell twice)', () => {
  const slab = obj('rect', 100, -100, 60, 300, 'refractor', { n: 1.5, dispersion: 0 })
  const r = main(O.traceRays([source(0, 0, 30, { wavelength: 589 }), slab]))
  const inDir = dirOf(r.points[0], r.points[1])
  const outDir = dirOf(r.points[2], r.points[3])
  assert.ok(Math.abs(inDir.x - outDir.x) < 1e-6 && Math.abs(inDir.y - outDir.y) < 1e-6)
  // inside: sin θt = sin 30° / 1.5
  const mid = dirOf(r.points[1], r.points[2])
  assert.ok(Math.abs(mid.y - Math.sin(Math.PI / 6) / 1.5) < 1e-6)
})

test('prism disperses white light: violet deviates more than red', () => {
  const prism = obj('polygon', 100, -60, 120, 104, 'refractor', { n: 1.52, dispersion: 0.0042 }, { points: [[60, 0], [120, 104], [0, 104]] })
  const rays = O.traceRays([source(0, 20, -10, { white: 1 }), prism])
  const exitAngle = (nm) => {
    const r = main(rays.filter((q) => q.wavelengthNm === nm))
    const d = dirOf(r.points[r.points.length - 2], r.points[r.points.length - 1])
    return Math.atan2(d.y, d.x)
  }
  const violet = exitAngle(O.WHITE_NM[0])
  const red = exitAngle(O.WHITE_NM[O.WHITE_NM.length - 1])
  assert.ok(violet > red, `violet ${violet} should bend further (downward) than red ${red}`)
  // White-light bookkeeping: the stretch before the prism is shared.
  assert.ok(rays[0].shared >= 2)
})

test('total internal reflection at a 45° face (n = 1.52 > √2)', () => {
  // Right-angle prism, ray enters the vertical leg normally, meets the
  // hypotenuse at 45° > θc = 41.1° and must turn 90°.
  const prism = obj('polygon', 100, 0, 100, 100, 'refractor', { n: 1.52, dispersion: 0 }, { points: [[0, 0], [100, 100], [0, 100]] })
  const r = main(O.traceRays([source(0, 70, 0, { wavelength: 589 }), prism]))
  const after = dirOf(r.points[2], r.points[3])
  assert.ok(Math.abs(after.x) < 1e-6 && Math.abs(Math.abs(after.y) - 1) < 1e-6, JSON.stringify(after))
})

test('Fresnel: normal incidence on glass reflects ((n−1)/(n+1))² = 4%', () => {
  assert.ok(Math.abs(O.fresnelR(1, 1.5, 1, 1) - 0.04) < 1e-9)
})

test('concave mirror brings a parallel ray to its focus at f', () => {
  const mirror = vline(300, -100, 100, 'opticalMirror', { f: 100 })
  const r = O.traceRays([source(0, 30, 0, { wavelength: 589 }), mirror])[0]
  const hit = r.points[1]
  const d = dirOf(r.points[1], r.points[2])
  // where does the reflected ray cross the axis (y = 0)?
  const t = -hit.y / d.y
  assert.ok(Math.abs(hit.x + d.x * t - 200) < 0.5, `crosses at x=${hit.x + d.x * t}`)
})

test("Young's double slit: fringe spacing Δy = λL/d", () => {
  // Far field (Fraunhofer): aperture² / λL ≪ 1, where Δy = λL/d holds.
  const L = 500000
  const d = 1000
  const slit = vline(100, -7500, 7500, 'slit', { gap: 100, count: 2, spacing: d })
  const screen = vline(100 + L, -30000, 30000, 'opticalScreen', {})
  const [pat] = O.screenPatterns([source(0, 0, 0, { wavelength: 500 }), slit, screen])
  const n = pat.intensity.length
  const ys = (i) => -30000 + (60000 * i) / (n - 1)
  const peaks = []
  for (let i = 1; i < n - 1; i++)
    if (pat.intensity[i] > pat.intensity[i - 1] && pat.intensity[i] >= pat.intensity[i + 1] && pat.intensity[i] > 0.3) peaks.push(ys(i))
  // First-to-last over the whole run — one gap is quantised to the sampling step.
  const mean = (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1)
  const expected = ((500 / O.NM_PER_PX) * L) / d
  assert.ok(Math.abs(mean - expected) / expected < 0.03, `spacing ${mean} vs ${expected}`)
})

test('grating: first order at d sin θ = λ', () => {
  const d = 400
  const L = 1600000 // far field for the grating
  const slit = vline(100, -6000, 6000, 'slit', { gap: 80, count: 12, spacing: d })
  const screen = vline(100 + L, -120000, 120000, 'opticalScreen', {})
  const [pat] = O.screenPatterns([source(0, 0, 0, { wavelength: 600 }), slit, screen])
  const n = pat.intensity.length
  let best = -1
  let bestY = 0
  for (let i = 0; i < n; i++) {
    const y = -120000 + (240000 * i) / (n - 1)
    if (y > 32000 && y < 120000 && pat.intensity[i] > best) {
      best = pat.intensity[i]
      bestY = y
    }
  }
  const expected = L * Math.tan(Math.asin(600 / O.NM_PER_PX / d))
  assert.ok(Math.abs(bestY - expected) / expected < 0.02, `first order at ${bestY}, expected ${expected}`)
})

test('spectral colours: 650 nm is red, 530 nm green, 450 nm blue', () => {
  const dom = (nm) => {
    const c = O.wavelengthRGB(nm)
    return ['r', 'g', 'b'][c.indexOf(Math.max(...c))]
  }
  assert.equal(dom(650), 'r')
  assert.equal(dom(530), 'g')
  assert.equal(dom(450), 'b')
})

test('photons: particle statistics reproduce the wave intensities', () => {
  // Seeded LCG so the check is deterministic.
  let seed = 7
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  // Normal incidence on glass: 4% of photons reflect at the first face.
  const slab = obj('rect', 100, -100, 60, 300, 'refractor', { n: 1.5, dispersion: 0 })
  const scene = [source(0, 0, 0, { wavelength: 589 }), slab]
  let back = 0
  const N = 6000
  for (let i = 0; i < N; i++) {
    const ph = O.tracePhoton(scene, [], rand)
    if (ph.points[1].x < 101 && ph.points[2].x < 100) back++
  }
  assert.ok(Math.abs(back / N - 0.04) < 0.01, `reflected ${back / N}`)
  // Inside glass the segment is tagged with n, so crests/photons slow to c/n.
  assert.equal(O.tracePhoton([source(0, 0, 0, { wavelength: 589 }), slab], [], () => 0.99).n[1], 1.5)

  // Double slit: photons land on the screen at Born-rule positions, and the
  // centre fringe collects far more hits than the first dark fringe.
  const L = 3000 // inside the tracer's 4000 px reach
  const slit = vline(100, -600, 600, 'slit', { gap: 16, count: 2, spacing: 160 })
  const screen = vline(100 + L, -1500, 1500, 'opticalScreen', {})
  const ds = [source(0, 0, 0, { wavelength: 600, aperture: 240 }), slit, screen]
  const pats = O.screenPatterns(ds)
  const hits = []
  for (let i = 0; i < 4000; i++) {
    const ph = O.tracePhoton(ds, pats, rand)
    if (ph.landed) hits.push(-1500 + 3000 * ph.landed.t)
  }
  assert.ok(hits.length > 300, `only ${hits.length} photons got through`)
  const dy = ((600 / O.NM_PER_PX) * L) / 160 // 450 px fringe spacing
  const near = (y0) => hits.filter((y) => Math.abs(y - y0) < 40).length
  assert.ok(near(0) > 4 * near(dy / 2), `bright ${near(0)} vs dark ${near(dy / 2)}`)
})

test('white photons stay white until the prism, then carry their own colour', () => {
  const prism = obj('polygon', 100, -60, 120, 104, 'refractor', { n: 1.52, dispersion: 0.02 }, { points: [[60, 0], [120, 104], [0, 104]] })
  const scene = [source(0, 0, 0, { white: 1 }), prism]
  const exits = {}
  let seed = 3
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = 0; i < 400; i++) {
    const ph = O.tracePhoton(scene, [], rand)
    if (ph.points.length < 4) continue
    // undispersed stretch ends at the first glass face
    assert.ok(ph.shared >= 2 && ph.shared < ph.points.length)
    const d = dirOf(ph.points[ph.points.length - 2], ph.points[ph.points.length - 1])
    exits[ph.wavelengthNm] = d
  }
  // violet leaves the prism bent further than red
  const ang = (d) => Math.atan2(d.y, d.x)
  assert.ok(Math.abs(ang(exits[410])) > Math.abs(ang(exits[670])), JSON.stringify(exits))
})
