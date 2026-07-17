// Algorithm analysis from an actual execution trace. Everything here is
// *measured* from the run, then matched against classic recurrence shapes —
// the UI labels it as an estimate, never as a proof.

import type { CallNode, Invocation, RecurrenceReport, TraceResult } from './trace'

// ── size-metric inference ───────────────────────────────────────────────────
// A recursive function's "problem size" is usually one numeric argument (n)
// or the width of a range (hi − lo). Try every candidate and keep the one
// that shrinks most consistently from parent to child.

interface Metric {
  label: string
  get: (nums: number[]) => number
}

function candidateMetrics(argCount: number): Metric[] {
  const ms: Metric[] = []
  for (let i = 0; i < argCount; i++) {
    ms.push({ label: argCount === 1 ? 'n' : `arg${i + 1}`, get: (nums) => nums[i] })
  }
  for (let i = 0; i < argCount; i++) {
    for (let j = 0; j < argCount; j++) {
      if (i === j) continue
      ms.push({ label: `arg${j + 1} − arg${i + 1}`, get: (nums) => nums[j] - nums[i] })
    }
  }
  return ms
}

interface Pair { parent: number; child: number }

function scoreMetric(m: Metric, invs: Invocation[]): { pairs: Pair[]; ok: number } {
  const pairs: Pair[] = []
  let ok = 0
  for (const inv of invs) {
    const p = m.get(inv.nums)
    if (!Number.isFinite(p)) continue
    for (const c of inv.childNums) {
      const cv = m.get(c)
      if (!Number.isFinite(cv)) continue
      pairs.push({ parent: p, child: cv })
      if (Math.abs(cv) < Math.abs(p)) ok++
    }
  }
  return { pairs, ok }
}

/** Least-squares slope of log(y) on log(x) for x>1, y>0. */
function loglogSlope(points: { x: number; y: number }[]): number | null {
  const pts = points.filter((p) => p.x > 1 && p.y > 0).map((p) => ({ x: Math.log(p.x), y: Math.log(p.y) }))
  if (pts.length < 2) return null
  const n = pts.length
  const sx = pts.reduce((s, p) => s + p.x, 0)
  const sy = pts.reduce((s, p) => s + p.y, 0)
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0)
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0)
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-9) return null
  return (n * sxy - sx * sy) / denom
}

const snapExponent = (d: number): number => {
  const snaps = [0, 0.5, 1, 1.5, 2, 3]
  let best = snaps[0]
  for (const s of snaps) if (Math.abs(d - s) < Math.abs(d - best)) best = s
  return best
}

const workLabel = (d: number): string => (d <= 0 ? 'O(1)' : d === 0.5 ? 'O(√n)' : d === 1 ? 'O(n)' : `O(n^${d})`)

function analyzeRecursiveFn(fn: string, invs: Invocation[], callNodes: Record<string, CallNode>): RecurrenceReport | null {
  const internal = invs.filter((i) => i.childNums.length > 0)
  if (internal.length === 0) return null
  const argCount = Math.max(...invs.map((i) => i.nums.length), 0)
  if (argCount === 0) return null

  // pick size metric
  let best: { m: Metric; pairs: Pair[]; ok: number } | null = null
  for (const m of candidateMetrics(argCount)) {
    const s = scoreMetric(m, internal)
    if (s.pairs.length === 0) continue
    if (!best || s.ok / s.pairs.length > best.ok / best.pairs.length + 1e-9) best = { m, pairs: s.pairs, ok: s.ok }
  }
  if (!best || best.ok / best.pairs.length < 0.75) return null
  const metric = best.m

  // branching factor a — average recursive children among internal calls
  const aRaw = internal.reduce((s, i) => s + i.childNums.length, 0) / internal.length
  const a = Math.max(1, Math.round(aRaw))

  // shrink pattern: divide (child ≈ parent/b) vs subtract (child ≈ parent − c)
  const usable = best.pairs.filter((p) => Math.abs(p.parent) > 0)
  const ratios = usable.filter((p) => p.child !== 0).map((p) => p.parent / p.child)
  const diffs = usable.map((p) => p.parent - p.child)
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
  const spread = (xs: number[]) => {
    if (xs.length < 2) return 0
    const m = mean(xs)
    return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m)))) / Math.max(1e-9, Math.abs(m))
  }
  const divideConsistent = ratios.length >= 2 && spread(ratios) < 0.25 && mean(ratios) > 1.3
  const subtractConsistent = diffs.length >= 1 && spread(diffs) < 0.35 && mean(diffs) > 0

  // Multi-step subtraction (Fibonacci-type): every internal call branches to
  // a small fixed set of decrements, e.g. {n−1, n−2}.
  const roundedDiffs = diffs.map((x) => Math.round(x)).filter((x) => x > 0)
  const distinctDiffs = [...new Set(roundedDiffs)].sort((x, y) => x - y)
  const multiDiff =
    distinctDiffs.length >= 2 &&
    distinctDiffs.length <= 3 &&
    a === distinctDiffs.length &&
    roundedDiffs.length >= distinctDiffs.length * 2

  // Work exponent d from exclusive ops vs size. Per-call overhead flattens a
  // naive fit at small sizes, so: average ops per size, subtract the leaf
  // (base-case) cost as the overhead estimate, and fit on the larger sizes.
  const leafOps = invs.filter((i) => i.childNums.length === 0).map((i) => i.exclusiveOps)
  const baseline = leafOps.length > 0 ? mean(leafOps) : 0
  const bySize = new Map<number, number[]>()
  for (const i of internal) {
    const s = Math.round(Math.abs(metric.get(i.nums)))
    if (s <= 1) continue
    const list = bySize.get(s) ?? []
    list.push(i.exclusiveOps)
    bySize.set(s, list)
  }
  let workPts = [...bySize.entries()]
    .sort((p, q) => p[0] - q[0])
    .map(([s, ops]) => ({ x: s, y: Math.max(1, mean(ops) - baseline) }))
  if (workPts.length >= 4) workPts = workPts.slice(Math.floor(workPts.length / 2))
  else if (workPts.length === 3) workPts = workPts.slice(1)
  const slope = loglogSlope(workPts)
  const d = snapExponent(slope ?? 0)

  const calls = invs.length
  const maxDepth = Math.max(0, ...Object.values(callNodes).filter((n) => n.fn === fn).map((n) => n.depth))
  const sizeNote = `size n = ${metric.label}`

  if (divideConsistent) {
    const b = Math.max(2, Math.round(mean(ratios)))
    const formula = `T(n) = ${a === 1 ? '' : `${a}·`}T(n/${b}) + ${workLabel(d)}`
    // master theorem
    const critical = Math.log(a) / Math.log(b)
    let bigO: string
    let method: string
    if (Math.abs(critical - d) < 0.1) {
      bigO = d === 0 ? 'O(log n)' : d === 1 ? 'O(n log n)' : `O(n^${d} log n)`
      method = 'master theorem, case 2'
    } else if (critical > d) {
      const ex = Math.round(critical * 100) / 100
      bigO = ex === 1 ? 'O(n)' : `O(n^${ex})`
      method = 'master theorem, case 1'
    } else {
      bigO = workLabel(d).replace('O', 'O')
      method = 'master theorem, case 3'
    }
    return { fn, formula, bigO, sizeNote, method, calls, maxDepth }
  }

  if (multiDiff) {
    const terms = distinctDiffs.map((c) => `T(n−${c})`).join(' + ')
    const formula = `T(n) = ${terms} + ${workLabel(d)}`
    const fibType = distinctDiffs.length === 2 && distinctDiffs[0] === 1 && distinctDiffs[1] === 2
    return {
      fn,
      formula,
      bigO: fibType ? 'O(φⁿ) ≈ O(1.62ⁿ)' : `O(${a}ⁿ)`,
      sizeNote,
      method: fibType ? 'Fibonacci-type branching — exponential' : 'branching recursion — exponential',
      calls,
      maxDepth,
    }
  }

  if (subtractConsistent) {
    const c = Math.max(1, Math.round(mean(diffs)))
    const step = c === 1 ? 'n−1' : `n−${c}`
    const formula = `T(n) = ${a === 1 ? '' : `${a}·`}T(${step}) + ${workLabel(d)}`
    let bigO: string
    let method: string
    if (a === 1) {
      bigO = d === 0 ? 'O(n)' : d === 1 ? 'O(n²)' : `O(n^${d + 1})`
      method = 'linear recursion (unrolling)'
    } else {
      bigO = `O(${a}ⁿ)`
      method = 'branching recursion — exponential'
    }
    return { fn, formula, bigO, sizeNote, method, calls, maxDepth }
  }

  // couldn't classify the shrink — still report what was measured
  return {
    fn,
    formula: `T(n) = ~${a}·T(smaller) + ${workLabel(d)}`,
    bigO: 'unclassified',
    sizeNote,
    method: 'shrink pattern not consistent enough to classify',
    calls,
    maxDepth,
  }
}

export interface AnalysisReport {
  recurrences: RecurrenceReport[]
  /** heuristic for the iterative part, e.g. "O(n²) — 2 nested loops observed" */
  loopEstimate: string | null
  perFunction: { fn: string; calls: number; exclusiveOps: number }[]
}

export function analyzeTrace(t: TraceResult): AnalysisReport {
  // group invocations by fn, keep only recursive ones
  const byFn = new Map<string, Invocation[]>()
  for (const inv of t.invocations) {
    const list = byFn.get(inv.fn) ?? []
    list.push(inv)
    byFn.set(inv.fn, list)
  }
  const recurrences: RecurrenceReport[] = []
  for (const [fn, invs] of byFn) {
    if (fn === 'main' || fn === 'top-level' || fn === 'globals') continue
    if (!invs.some((i) => i.childNums.length > 0)) continue
    const r = analyzeRecursiveFn(fn, invs, t.callNodes)
    if (r) recurrences.push(r)
  }

  let loopEstimate: string | null = null
  const depth = t.counters.maxLoopDepth
  if (depth > 0) {
    const label = depth === 1 ? 'O(n)' : depth === 2 ? 'O(n²)' : depth === 3 ? 'O(n³)' : `O(n^${depth})`
    loopEstimate = `${label} — deepest observed loop nesting is ${depth} (heuristic: assumes each level scales with input)`
  }

  const perFunction = [...byFn.entries()]
    .filter(([fn]) => fn !== 'globals')
    .map(([fn, invs]) => ({
      fn,
      calls: invs.length,
      exclusiveOps: invs.reduce((s, i) => s + i.exclusiveOps, 0),
    }))
    .sort((a, b) => b.exclusiveOps - a.exclusiveOps)

  return { recurrences, loopEstimate, perFunction }
}
