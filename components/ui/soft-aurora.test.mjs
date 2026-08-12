// Regression test for the aurora's theme-colour resolution.
//
// The upstream React Bits component takes hex props and parses them with a
// hex-only helper. This app's palette is authored entirely in oklch() and
// changes per theme, so the colours are resolved at runtime instead. Two
// traps that had to be handled, both caught by measuring rather than assuming:
//
//  1. getComputedStyle does NOT always convert oklch — some engines return
//     the literal `oklch(l c h)` string. Reading "0.58 0.14 255" as if it
//     were rgb collapses every theme to the same blue.
//  2. When it does convert, it may return `color(srgb r g b)` with channels
//     already in 0..1; dividing those by 255 yields near-black.
//
// Run directly:  node components/ui/soft-aurora.test.mjs

import assert from 'node:assert/strict'

function oklchToRgb(css) {
  const m = css.match(/-?[\d.]+/g)
  if (!m || m.length < 3) return null
  const L = Number(m[0])
  const C = Number(m[1])
  const h = (Number(m[2]) * Math.PI) / 180
  const a = C * Math.cos(h)
  const bb = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb
  const l = l_ ** 3
  const mm = m_ ** 3
  const s = s_ ** 3
  const lr = +4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s
  const enc = (x) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055
  return [enc(lr), enc(lg), enc(lb)]
}

const clamp01 = (c) => c.map((x) => Math.min(1, Math.max(0, x)))

/** The format-detection half, given whatever getComputedStyle returned. */
function fromComputed(computed, fallback) {
  if (computed.startsWith('oklch')) return clamp01(oklchToRgb(computed) ?? fallback)
  const m = computed.match(/-?[\d.]+/g)
  if (!m || m.length < 3) return fallback
  const [r, g, b] = m.slice(0, 3).map(Number)
  return clamp01(computed.startsWith('color(') ? [r, g, b] : [r / 255, g / 255, b / 255])
}

// ── anchors: white and black must be exact ──────────────────────────────────
assert.ok(oklchToRgb('oklch(1 0 0)').every((x) => Math.abs(x - 1) < 0.01), 'white')
assert.ok(oklchToRgb('oklch(0 0 0)').every((x) => Math.abs(x) < 0.01), 'black')

// ── the actual palette produces distinct, in-range colours ──────────────────
const PALETTE = {
  'light blue': 'oklch(0.58 0.14 255)',
  'dark blue': 'oklch(0.74 0.12 255)',
  'light violet': 'oklch(0.55 0.16 300)',
  'dark violet': 'oklch(0.72 0.14 300)',
}
for (const [name, css] of Object.entries(PALETTE)) {
  const c = oklchToRgb(css)
  assert.ok(c, `${name} parses`)
  assert.ok(
    c.every((x) => x >= -0.01 && x <= 1.01),
    `${name} lands in range (got ${c.map((x) => x.toFixed(2))})`
  )
}

// The original bug: every theme collapsed to the same blue. Blue and violet
// must stay visibly apart, and light must differ from dark.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
assert.ok(
  dist(oklchToRgb(PALETTE['light blue']), oklchToRgb(PALETTE['light violet'])) > 0.1,
  'blue and violet are distinguishable'
)
assert.ok(
  dist(oklchToRgb(PALETTE['light blue']), oklchToRgb(PALETTE['dark blue'])) > 0.1,
  'light and dark themes differ'
)

// ── every getComputedStyle format is handled ────────────────────────────────
const FB = [0.4, 0.6, 1]
{
  // rgb(): 0..255 → divide
  const c = fromComputed('rgb(58, 123, 203)', FB)
  assert.ok(Math.abs(c[0] - 58 / 255) < 0.001, 'rgb() channels divided by 255')
  // color(srgb …): already 0..1 → do NOT divide
  const d = fromComputed('color(srgb 0.227 0.483 0.796)', FB)
  assert.ok(Math.abs(d[0] - 0.227) < 0.001, 'color(srgb) channels used as-is')
  // oklch(): converted, not read as rgb
  const e = fromComputed('oklch(0.58 0.14 255)', FB)
  assert.ok(e[1] > 0.2, `oklch converted, not misread (got ${e.map((x) => x.toFixed(2))})`)
}

// ── malformed input falls back instead of rendering black ───────────────────
for (const bad of ['', 'not-a-color', 'rgb(', 'oklch()']) {
  assert.deepEqual(fromComputed(bad, FB), FB, `${JSON.stringify(bad)} uses the fallback`)
}

// ── light-theme detection ───────────────────────────────────────────────────
// The aurora composites additively: luminous over a dark ground, but a grey
// wash over a light one. `uLight` drives the correction, and it's measured
// from the resolved --background rather than a `class === 'dark'` check —
// this app ships six themes and a new light one must not be mis-tagged.
// Mirrors `lightness()` in soft-aurora.tsx.
function lightness(bg) {
  const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]
  return Math.max(0, Math.min(1, (lum - 0.5) / 0.35))
}

assert.equal(lightness([0, 0, 0]), 0, 'black ground gets no correction')
assert.equal(lightness([1, 1, 1]), 1, 'white ground gets the full correction')
// Every --background that actually ships in app/globals.css. Each must land
// on the correct side; a light theme reading as dark is the bug this guards.
const DARK_BGS = [
  'oklch(0.17 0.01 270)',
  'oklch(0.245 0.016 265)',
  'oklch(0.13 0.008 270)',
  'oklch(0.05 0 0)',
  'oklch(0.22 0.014 190)',
  'oklch(0.13 0 0)',
]
const LIGHT_BGS = [
  'oklch(0.982 0.003 95)',
  'oklch(0.97 0.014 90)',
  'oklch(0.975 0.014 20)',
  'oklch(0.974 0.026 90.1)',
  'oklch(0.964 0.023 61.2)',
  'oklch(0.975 0.016 340)',
]
for (const bg of DARK_BGS) {
  assert.equal(lightness(clamp01(oklchToRgb(bg))), 0, `${bg} is dark — no correction`)
}
for (const bg of LIGHT_BGS) {
  assert.ok(lightness(clamp01(oklchToRgb(bg))) > 0.9, `${bg} is light — full correction`)
}
// Monotonic across the ramp — no step that would pop on a theme switch.
let prev = -1
for (const l of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
  const v = lightness([l, l, l])
  assert.ok(v >= prev, `ramp is monotonic at ${l}`)
  prev = v
}

console.log('soft-aurora: all checks passed')
