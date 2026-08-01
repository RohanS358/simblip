// Pure math for the 3D surface plotter (components/objects/surface3d.tsx):
// turns one formula string into a height-field grid. Two input shapes:
//   explicit  z = f(x, y)              — one direct evaluation per grid point
//   implicit  x^2 + y^2 + z^2 = 25     — root-find the dependent axis
// The dependent axis (which variable is "height") is user-chosen, not
// always z — "2 fixed axes and a third as a function of them" generalizes
// to any of the three variables, the 3D analog of the 2D grid's y = f(x).
//
// Implicit equations are solved by scanning the dependent axis for a sign
// change of (LHS − RHS) and bisecting — the same trick a graphing
// calculator uses for y = ±√(...). Scanning from BOTH ends of the range
// gives two branches ("upper"/"lower") that together reconstruct a closed
// surface like a sphere as two height-field caps. Kept framework-free (no
// three.js) so it's testable in isolation; the renderer turns the grid into
// geometry.

import { compileExprChecked, evalExpr, type Scope } from '@/lib/formula/engine'

export type Axis = 'x' | 'y' | 'z'
export type AxisBounds = { min: number; max: number }
export type SurfaceBounds = Record<Axis, AxisBounds>

export interface SurfaceGrid {
  /** first base-plane axis samples, length = res */
  uVals: number[]
  /** second base-plane axis samples, length = res */
  vVals: number[]
  /** height[i][j] = dependent-axis value at (uVals[i], vVals[j]); NaN where undefined/out of domain */
  height: number[][]
}

const ALL_AXES: Axis[] = ['x', 'y', 'z']

/** The two base-plane variable names for a given dependent axis, e.g.
 *  dependent 'z' → base plane is (x, y). */
export function baseAxes(dependent: Axis): [Axis, Axis] {
  const others = ALL_AXES.filter((a) => a !== dependent)
  return [others[0], others[1]]
}

// A bare '=' that isn't part of ==, !=, <=, >= marks an implicit equation
// ("x^2+y^2+z^2=25") rather than a direct expression ("sin(x)*cos(y)").
const IMPLICIT_RE = /(?<![=!<>])=(?!=)/

export function isImplicitExpr(expr: string): boolean {
  return IMPLICIT_RE.test(expr)
}

function splitImplicit(expr: string): [string, string] {
  const m = expr.search(IMPLICIT_RE)
  return [expr.slice(0, m).trim(), expr.slice(m + 1).trim()]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function sampleExplicit(expr: string, dependent: Axis, bounds: SurfaceBounds, res: number, scope: Scope): SurfaceGrid {
  const [ua, va] = baseAxes(dependent)
  const uVals = Array.from({ length: res }, (_, i) => lerp(bounds[ua].min, bounds[ua].max, i / (res - 1)))
  const vVals = Array.from({ length: res }, (_, j) => lerp(bounds[va].min, bounds[va].max, j / (res - 1)))
  // Compiled once outside the loop — a res=60 grid is 3,600 evaluations, and
  // evalExpr's full re-parse per call is what made high resolutions crawl.
  const f = compileExprChecked(expr)
  const s: Record<string, number> = { ...scope }
  const height = uVals.map((u) => {
    s[ua] = u
    return vVals.map((v) => {
      s[va] = v
      const { value, error } = f(s)
      return error ? NaN : value
    })
  })
  return { uVals, vVals, height }
}

const SCAN_STEPS = 40
const BISECT_STEPS = 18

function sampleImplicitBranch(
  expr: string,
  dependent: Axis,
  bounds: SurfaceBounds,
  res: number,
  scope: Scope,
  fromTop: boolean
): SurfaceGrid {
  const [ua, va] = baseAxes(dependent)
  const [lhs, rhs] = splitImplicit(expr)
  const uVals = Array.from({ length: res }, (_, i) => lerp(bounds[ua].min, bounds[ua].max, i / (res - 1)))
  const vVals = Array.from({ length: res }, (_, j) => lerp(bounds[va].min, bounds[va].max, j / (res - 1)))
  const { min: dMin, max: dMax } = bounds[dependent]

  // Compiled once — an implicit surface's scan+bisect can call this hundreds
  // of thousands of times per render (res² grid points × up to ~58 scan/
  // bisect steps × 2 sides), and evalExpr's full re-parse per call is what
  // actually made high resolutions freeze the tab.
  const fL = compileExprChecked(lhs)
  const fR = compileExprChecked(rhs)
  const s: Record<string, number> = { ...scope }
  const residual = (u: number, v: number, d: number): number => {
    s[ua] = u
    s[va] = v
    s[dependent] = d
    const { value: l, error: eL } = fL(s)
    const { value: r, error: eR } = fR(s)
    return eL || eR ? NaN : l - r
  }

  const height = uVals.map((u) =>
    vVals.map((v) => {
      let prevD = fromTop ? dMax : dMin
      let prevR = residual(u, v, prevD)
      for (let k = 1; k <= SCAN_STEPS; k++) {
        const d = fromTop ? lerp(dMax, dMin, k / SCAN_STEPS) : lerp(dMin, dMax, k / SCAN_STEPS)
        const r = residual(u, v, d)
        if (!Number.isFinite(prevR) || !Number.isFinite(r)) {
          prevD = d
          prevR = r
          continue
        }
        if (prevR === 0) return prevD
        if ((prevR < 0) !== (r < 0)) {
          let lo = prevD
          let hi = d
          let rLo = prevR
          for (let b = 0; b < BISECT_STEPS; b++) {
            const mid = (lo + hi) / 2
            const rMid = residual(u, v, mid)
            if ((rLo < 0) === (rMid < 0)) { lo = mid; rLo = rMid } else { hi = mid }
          }
          return (lo + hi) / 2
        }
        prevD = d
        prevR = r
      }
      return NaN
    })
  )
  return { uVals, vVals, height }
}

/** One grid for an explicit formula, or two (upper/lower branch) for an
 *  implicit equation — e.g. a sphere reconstructs as two hemisphere caps. */
export function sampleSurface(expr: string, dependent: Axis, bounds: SurfaceBounds, res: number, scope: Scope): SurfaceGrid[] {
  if (!expr.trim()) return []
  if (!isImplicitExpr(expr)) return [sampleExplicit(expr, dependent, bounds, res, scope)]
  return [
    sampleImplicitBranch(expr, dependent, bounds, res, scope, true),
    sampleImplicitBranch(expr, dependent, bounds, res, scope, false),
  ]
}

/** Central-difference partial derivatives of an EXPLICIT f(u,v) at a point —
 *  meaningless for implicit equations, so callers only use this in that mode. */
export function partials(expr: string, ua: Axis, va: Axis, u: number, v: number, scope: Scope, hu: number, hv: number) {
  const f = (uu: number, vv: number) => evalExpr(expr, { ...scope, [ua]: uu, [va]: vv }, NaN).value
  const z = f(u, v)
  const dU = (f(u + hu, v) - f(u - hu, v)) / (2 * hu)
  const dV = (f(u, v + hv) - f(u, v - hv)) / (2 * hv)
  return { z, dU, dV }
}

/** Double integral of the rendered grid over its base rectangle — a simple
 *  per-cell average-of-corners Riemann sum. Reuses the already-computed
 *  render grid rather than a separate high-res pass; NaN cells (outside the
 *  formula's domain) are skipped, not treated as zero. */
export function integrateGrid(grid: SurfaceGrid): number {
  const { uVals, vVals, height } = grid
  if (uVals.length < 2 || vVals.length < 2) return 0
  const du = uVals[1] - uVals[0]
  const dv = vVals[1] - vVals[0]
  let sum = 0
  for (let i = 0; i < uVals.length - 1; i++) {
    for (let j = 0; j < vVals.length - 1; j++) {
      const avg = (height[i][j] + height[i + 1][j] + height[i][j + 1] + height[i + 1][j + 1]) / 4
      if (Number.isFinite(avg)) sum += avg * du * dv
    }
  }
  return sum
}
