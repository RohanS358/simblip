// Function sampling for the Graph object's formula plots.
//
// A uniform 240-point grid had three visible failures: a vertical line drawn
// straight through every asymptote (tan x, 1/x), sharp features between grid
// points simply missing, and — because the old evaluator held the last good
// value on a domain error — flat fake lines where a function is undefined
// (sqrt(4 − x²) past x = 2). This samples adaptively and returns explicit
// gaps instead.

export type PlotFn = (x: number) => number

export interface SampledRow {
  x: number
  /** NaN = no value here (undefined, or a break across a discontinuity) */
  ys: number[]
}

const BASE = 200
const MAX_POINTS = 1600
const PASSES = 4

/** Robust spread of a set of values (5th–95th percentile), so one huge
 *  value near an asymptote can't define "large". */
export function robustRange(values: number[]): { lo: number; hi: number } | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length < 2) return null
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]
  return { lo: q(0.05), hi: q(0.95) }
}

export interface Sampled {
  rows: SampledRow[]
  /** every function's values on the UNIFORM base grid — the unbiased sample
   *  for choosing a y-range (refined points cluster at poles) */
  uniform: number[]
}

/** `passes` trades accuracy for speed — pan/zoom samples coarsely while
 *  moving, then refines once it settles. */
export function sampleFunctions(fns: PlotFn[], x0: number, x1: number, passes = PASSES): Sampled {
  if (!(x1 > x0) || fns.length === 0) return { rows: [], uniform: [] }
  const cache = new Map<number, number[]>()
  const at = (x: number) => {
    let ys = cache.get(x)
    if (!ys) {
      ys = fns.map((f) => {
        const y = f(x)
        return Number.isFinite(y) ? y : NaN
      })
      cache.set(x, ys)
    }
    return ys
  }

  let xs = Array.from({ length: BASE + 1 }, (_, i) => x0 + ((x1 - x0) * i) / BASE)
  const uniform = xs.flatMap((x) => at(x))
  const ranges = fns.map((_, j) => robustRange(xs.map((x) => at(x)[j])))
  const scale = ranges.map((r) => (r ? Math.max(r.hi - r.lo, 1e-12) : 1))

  // Refine where a straight chord misrepresents the curve (or where the
  // function starts/stops being defined), up to a point budget.
  for (let pass = 0; pass < passes && xs.length < MAX_POINTS; pass++) {
    const next: number[] = [xs[0]]
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]
      const b = xs[i]
      const m = (a + b) / 2
      const ya = at(a)
      const yb = at(b)
      const ym = at(m)
      const refine = fns.some((_, j) => {
        const fa = Number.isFinite(ya[j])
        const fb = Number.isFinite(yb[j])
        if (fa !== fb) return true
        if (!fa) return false
        return Math.abs(ym[j] - (ya[j] + yb[j]) / 2) > 0.004 * scale[j] || !Number.isFinite(ym[j])
      })
      if (refine && next.length + (xs.length - i) < MAX_POINTS) next.push(m)
      next.push(b)
    }
    if (next.length === xs.length) break
    xs = next
  }

  // Break the line across jumps: a step bigger than the function's whole
  // typical range, that refinement could not close, is a discontinuity
  // (pole or step), not a steep stretch — draw a gap, not a wall.
  const rows: SampledRow[] = []
  for (let i = 0; i < xs.length; i++) {
    const ys = at(xs[i]).slice()
    if (i > 0) {
      const prev = at(xs[i - 1])
      const breaks = fns.map((_, j) => {
        const p = prev[j]
        const c = ys[j]
        if (!Number.isFinite(p) || !Number.isFinite(c)) return false
        const jump = Math.abs(c - p)
        return jump > 1.5 * scale[j] || (jump > 0.5 * scale[j] && Math.sign(c) !== Math.sign(p) && Math.abs(c) + Math.abs(p) > 2 * scale[j])
      })
      if (breaks.some(Boolean)) rows.push({ x: (xs[i - 1] + xs[i]) / 2, ys: fns.map((_, j) => (breaks[j] ? NaN : (prev[j] + ys[j]) / 2)) })
    }
    rows.push({ x: xs[i], ys })
  }
  return { rows, uniform }
}

/** Y-axis bounds that ignore asymptote spikes: the robust range, padded,
 *  used only when the true extent is dominated by a few huge values. */
export function autoYDomain(values: number[]): [number, number] | null {
  const r = robustRange(values)
  if (!r) return null
  const finite = values.filter(Number.isFinite)
  const lo = Math.min(...finite)
  const hi = Math.max(...finite)
  const span = Math.max(r.hi - r.lo, 1e-9)
  if (hi - lo <= 6 * span) return null // nothing pathological — let the chart autoscale
  const pad = span * 0.35
  return [r.lo - pad, r.hi + pad]
}

// ── Plot entries ────────────────────────────────────────────────────────────
// One graph "formula" line can be any of the things people type into a
// graphing calculator, not just a bare expression:
//   y = x^2  ·  f(x) = sin x  ·  x^2      → function of the x axis
//   x = 3                                 → vertical line
//   (1, 2), (3, 4), (a, b)                → points (can use page variables)
//   (cos(t), sin(t))  [t = 0..10]         → parametric curve (default t ∈ 0..2π)

export type PlotEntry =
  | { kind: 'fn'; expr: string }
  | { kind: 'vline'; expr: string }
  | { kind: 'points'; pts: [string, string][] }
  | { kind: 'param'; x: string; y: string; t0: string; t1: string }

/** Split on commas at bracket depth 0. */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/** "(a, b)" → ['a', 'b'] — only when one paren pair wraps the whole string. */
function pair(s: string): [string, string] | null {
  if (!s.startsWith('(') || !s.endsWith(')')) return null
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0 && i < s.length - 1) return null
  }
  const parts = splitTop(s.slice(1, -1))
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null
}

export function parseEntry(raw: string): PlotEntry {
  let s = raw.trim()
  const range = s.match(/^(\(.*\))\s*,?\s*(?:for\s+)?t\s*=\s*(.+?)\s*\.\.\s*(.+)$/)
  if (range) s = range[1]
  const pairs = splitTop(s).map(pair)
  if (pairs.every(Boolean)) {
    const ps = pairs as [string, string][]
    if (ps.length === 1 && /\bt\b/.test(ps[0].join(' ')))
      return { kind: 'param', x: ps[0][0], y: ps[0][1], t0: range?.[2] ?? '0', t1: range?.[3] ?? '2*pi' }
    return { kind: 'points', pts: ps }
  }
  const eq = s.match(/^([a-zA-Z_]\w*)\s*(\(\s*[a-zA-Z_]\w*\s*\))?\s*=(?!=)\s*(.+)$/)
  if (eq) return eq[1] === 'x' && !eq[2] ? { kind: 'vline', expr: eq[3] } : { kind: 'fn', expr: eq[3] }
  return { kind: 'fn', expr: s }
}

// ── Axis ticks ──────────────────────────────────────────────────────────────
// Ticks on round 1-2-5 steps that stay put while you pan (they sit at
// multiples of the step, not at offsets from the edge).

export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

export function niceTicks(lo: number, hi: number, count: number): { ticks: number[]; step: number } {
  if (!(hi > lo)) return { ticks: [lo], step: 1 }
  const step = niceStep(hi - lo, count)
  const ticks: number[] = []
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && ticks.length < 200; k++)
    ticks.push(k === 0 ? 0 : Number((k * step).toPrecision(12)))
  return { ticks, step }
}

/** Grow [lo, hi] outward to whole steps, so auto ranges start and end on a tick. */
export function niceDomain(lo: number, hi: number, count: number): [number, number] {
  if (!(hi > lo)) return [lo - 1, hi + 1]
  const step = niceStep(hi - lo, count)
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step]
}

/** Tick label with exactly the decimals the step needs (0.1, not 0.1000000004). */
export function fmtTick(v: number, step: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e5 || a < 1e-3) return Number(v.toPrecision(3)).toExponential().replace('e+', 'e')
  return v.toFixed(Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))))
}
