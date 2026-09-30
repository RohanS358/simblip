// Numerical methods (ENSH 252), probability & statistics (ENSH 304) and the
// data-science course (ENCT 202): root finding, integration, ODEs, linear
// systems, interpolation, heat conduction, regression, distributions, Bayes,
// the central limit theorem and confidence intervals.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pnums, pstr, prows } from '../types'
import { box, dot, heading, line, makePlot, poly, toneAt, trace, txt } from '../draw'
import { compile, deriv, fx, gauss, rng } from '../expr'

const G_NUM = 'Numerical methods', G_STAT = 'Probability, statistics & data'

// ── Root finding ────────────────────────────────────────────────────────────

function rootRun(p: Params) {
  const method = pstr(p, 'method', 'bisection')
  const f = fx(pstr(p, 'f', 'x^3 - x - 2'))
  let a = pnum(p, 'a', 1), b = pnum(p, 'b', 2)
  const tol = pnum(p, 'tol', 1e-4), maxIt = pnum(p, 'maxIter', 40)
  const x0 = pnum(p, 'x0', 1.5)
  const rows: { x: number; note: string; lo?: number; hi?: number; f: number }[] = []
  if (method === 'bisection' || method === 'falsi') {
    if (f(a) * f(b) > 0) throw new LabError(`f(${a}) and f(${b}) have the same sign — there is no guaranteed root in [a, b]`)
    for (let i = 0; i < maxIt; i++) {
      const c = method === 'bisection' ? (a + b) / 2 : (a * f(b) - b * f(a)) / (f(b) - f(a))
      rows.push({ x: c, lo: a, hi: b, f: f(c), note: `${method === 'bisection' ? 'midpoint' : 'secant line meets the axis'} c = ${fmt(c, 6)}, f(c) = ${fmt(f(c), 6)} → ${f(a) * f(c) < 0 ? 'root is in [a, c]' : 'root is in [c, b]'}` })
      if (Math.abs(f(c)) < tol || Math.abs(b - a) < tol) break
      if (f(a) * f(c) < 0) b = c; else a = c
    }
  } else if (method === 'newton') {
    let x = x0
    for (let i = 0; i < maxIt; i++) {
      const d = deriv(f, x)
      if (Math.abs(d) < 1e-12) throw new LabError('the derivative is zero — Newton\'s method cannot continue from here')
      const xn = x - f(x) / d
      rows.push({ x: xn, f: f(xn), note: `x − f(x)/f′(x) = ${fmt(x, 6)} − ${fmt(f(x), 6)}/${fmt(d, 6)} = ${fmt(xn, 8)}` })
      if (Math.abs(xn - x) < tol) break
      x = xn
    }
  } else if (method === 'secant') {
    let x1 = a, x2 = b
    for (let i = 0; i < maxIt; i++) {
      const d = f(x2) - f(x1); if (Math.abs(d) < 1e-14) break
      const xn = x2 - (f(x2) * (x2 - x1)) / d
      rows.push({ x: xn, f: f(xn), note: `secant through the last two points meets the axis at ${fmt(xn, 8)}` })
      if (Math.abs(xn - x2) < tol) break
      x1 = x2; x2 = xn
    }
  } else throw new LabError('method is bisection, falsi, newton or secant')
  const lo = method === 'newton' ? Math.min(x0, rows[rows.length - 1].x) - 1 : Math.min(pnum(p, 'a', 1), pnum(p, 'b', 2)) - 0.3
  const hi = method === 'newton' ? Math.max(x0, rows[rows.length - 1].x) + 1 : Math.max(pnum(p, 'a', 1), pnum(p, 'b', 2)) + 0.3
  const ys = Array.from({ length: 60 }, (_, i) => f(lo + ((hi - lo) * i) / 59)).filter(Number.isFinite)
  const W = 620, H = 330
  const pl = makePlot(40, 30, 340, 230, lo, hi, Math.min(...ys, 0), Math.max(...ys, 0))
  const frames: Frame[] = rows.map((r, k) => {
    const d: Prim[] = [heading(20, 14, `${method} · f(x) = ${pstr(p, 'f', 'x^3 - x - 2')}`), ...pl.axes, pl.curve(f, 'blue')]
    for (let i = 0; i <= k; i++) d.push(dot(pl.X(rows[i].x), pl.Y(0), i === k ? 5 : 3, undefined, i === k ? 'amber' : 'mint', { solid: true }))
    if (r.lo !== undefined) d.push(line(pl.X(r.lo), pl.y0, pl.X(r.lo), pl.y0 + pl.h, 'violet', { dash: true }), line(pl.X(r.hi!), pl.y0, pl.X(r.hi!), pl.y0 + pl.h, 'violet', { dash: true }))
    d.push(txt(400, 50, 'iter   x            f(x)', { size: 10.5, bold: true, mono: true, tone: 'dim' }))
    rows.slice(Math.max(0, k - 9), k + 1).forEach((q, i, arr) => d.push(txt(400, 72 + i * 20, `${String(k - arr.length + 2 + i).padEnd(5)} ${q.x.toFixed(7).padEnd(12)} ${q.f.toExponential(2)}`, { size: 11, mono: true, tone: i === arr.length - 1 ? 'blue' : 'idle' })))
    return { draw: d, note: `Iteration ${k + 1}: ${r.note}.` }
  })
  const last = rows[rows.length - 1]
  return trace(W, H, frames, { root: fmt(last.x, 4), iterations: String(rows.length), residual: last.f.toExponential(2) })
}

// ── Numerical integration ───────────────────────────────────────────────────

export function integrate(f: (x: number) => number, a: number, b: number, n: number, rule: string): number {
  const h = (b - a) / n
  if (rule === 'trapezoid') { let s = (f(a) + f(b)) / 2; for (let i = 1; i < n; i++) s += f(a + i * h); return s * h }
  if (rule === 'simpson') { if (n % 2) throw new LabError('Simpson\'s 1/3 rule needs an even number of intervals'); let s = f(a) + f(b); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h); return (s * h) / 3 }
  if (rule === 'midpoint') { let s = 0; for (let i = 0; i < n; i++) s += f(a + (i + 0.5) * h); return s * h }
  throw new LabError('rule is trapezoid, simpson or midpoint')
}

function integRun(p: Params) {
  const src = pstr(p, 'f', 'sin(x)'), f = fx(src), a = pnum(p, 'a', 0), b = pnum(p, 'b', Math.PI), rule = pstr(p, 'rule', 'trapezoid')
  const n = pnum(p, 'n', 4)
  if (n < 1 || n > 200) throw new LabError('n must be 1–200')
  const exact = integrate(f, a, b, 4000, 'simpson')
  const ys = Array.from({ length: 80 }, (_, i) => f(a + ((b - a) * i) / 79))
  const pl = makePlot(40, 30, 380, 240, a, b, Math.min(...ys, 0), Math.max(...ys, 0) * 1.1)
  const steps = [...new Set([1, 2, 4, 8, 16, 32, n].filter((v) => v <= n && (rule !== 'simpson' || v % 2 === 0)))].sort((x, y) => x - y)
  const frames: Frame[] = steps.map((m) => {
    const h = (b - a) / m, d: Prim[] = [heading(20, 14, `${rule} rule · ∫ ${src} dx from ${fmt(a, 3)} to ${fmt(b, 3)}`), ...pl.axes]
    for (let i = 0; i < m; i++) {
      const x0 = a + i * h, x1 = x0 + h
      const pts = rule === 'trapezoid' ? [[pl.X(x0), pl.Y(0)], [pl.X(x0), pl.Y(f(x0))], [pl.X(x1), pl.Y(f(x1))], [pl.X(x1), pl.Y(0)]] : rule === 'midpoint' ? [[pl.X(x0), pl.Y(0)], [pl.X(x0), pl.Y(f((x0 + x1) / 2))], [pl.X(x1), pl.Y(f((x0 + x1) / 2))], [pl.X(x1), pl.Y(0)]] : [[pl.X(x0), pl.Y(0)], [pl.X(x0), pl.Y(f(x0))], [pl.X((x0 + x1) / 2), pl.Y(f((x0 + x1) / 2))], [pl.X(x1), pl.Y(f(x1))], [pl.X(x1), pl.Y(0)]]
      d.push(poly(pts, toneAt(i), { closed: true, fill: true, w: 1 }))
    }
    d.push(pl.curve(f, 'blue', 2.2))
    const v = integrate(f, a, b, m, rule)
    d.push(txt(440, 60, `n = ${m}`, { size: 13, mono: true, bold: true }), txt(440, 84, `I ≈ ${fmt(v, 6)}`, { size: 13, mono: true, tone: 'amber' }), txt(440, 108, `exact ≈ ${fmt(exact, 6)}`, { size: 12, mono: true, tone: 'dim' }), txt(440, 132, `error ${Math.abs(v - exact).toExponential(2)}`, { size: 12, mono: true, tone: 'rose' }))
    return { draw: d, note: `${m} interval${m > 1 ? 's' : ''}: the area is approximated by ${rule === 'trapezoid' ? 'trapezoids' : rule === 'midpoint' ? 'midpoint rectangles' : 'parabolic arcs'}; more intervals shrink the error.` }
  })
  return trace(620, 320, frames, { value: fmt(integrate(f, a, b, n, rule), 6), exact: fmt(exact, 6), error: Math.abs(integrate(f, a, b, n, rule) - exact).toExponential(2) })
}

// ── ODE ─────────────────────────────────────────────────────────────────────

function odeRun(p: Params) {
  const fsrc = pstr(p, 'f', 'x + y'), e = compile(fsrc)
  const f = (x: number, y: number) => e({ x, y })
  const x0 = pnum(p, 'x0', 0), y0 = pnum(p, 'y0', 1), h = pnum(p, 'h', 0.1), xEnd = pnum(p, 'xEnd', 1)
  const methods = pstr(p, 'methods', 'euler rk4').split(/[\s,]+/).filter(Boolean)
  const exactSrc = pstr(p, 'exact', '2*exp(x) - x - 1')
  const ex = pstr(p, 'exact', '') ? fx(exactSrc) : null
  const steps = Math.round((xEnd - x0) / h)
  if (steps < 1 || steps > 200) throw new LabError('h and xEnd give 1–200 steps')
  const runM = (m: string): number[][] => {
    const pts = [[x0, y0]]; let x = x0, y = y0
    for (let i = 0; i < steps; i++) {
      if (m === 'euler') y += h * f(x, y)
      else if (m === 'heun') { const k1 = f(x, y), k2 = f(x + h, y + h * k1); y += (h / 2) * (k1 + k2) }
      else if (m === 'rk4') { const k1 = f(x, y), k2 = f(x + h / 2, y + (h / 2) * k1), k3 = f(x + h / 2, y + (h / 2) * k2), k4 = f(x + h, y + h * k3); y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4) }
      else throw new LabError('methods: euler, heun, rk4')
      x += h; pts.push([x, y])
    }
    return pts
  }
  const sols = methods.map((m) => ({ m, pts: runM(m) }))
  const all = sols.flatMap((s) => s.pts.map((q) => q[1])).concat(ex ? Array.from({ length: 20 }, (_, i) => ex(x0 + ((xEnd - x0) * i) / 19)) : [])
  const pl = makePlot(40, 30, 380, 240, x0, xEnd, Math.min(...all), Math.max(...all))
  const frames: Frame[] = []
  for (let k = 0; k <= steps; k += Math.max(1, Math.floor(steps / 20))) {
    const d: Prim[] = [heading(20, 14, `y′ = ${fsrc},  y(${x0}) = ${y0},  h = ${h}`), ...pl.axes]
    if (ex) d.push(pl.curve(ex, 'dim', 1.6))
    sols.forEach((s, i) => { d.push(poly(s.pts.slice(0, k + 1).map((q) => [pl.X(q[0]), pl.Y(q[1])]), toneAt(i), { w: 2 })); d.push(dot(pl.X(s.pts[k][0]), pl.Y(s.pts[k][1]), 4, undefined, toneAt(i), { solid: true })) })
    sols.forEach((s, i) => d.push(txt(440, 60 + i * 22, `${s.m}: y(${fmt(s.pts[k][0], 2)}) = ${fmt(s.pts[k][1], 5)}`, { size: 11.5, mono: true, tone: toneAt(i) })))
    if (ex) d.push(txt(440, 60 + sols.length * 22, `exact:  ${fmt(ex(sols[0].pts[k][0]), 5)}`, { size: 11.5, mono: true, tone: 'dim' }))
    frames.push({ draw: d, note: `Step ${k} of ${steps}, x = ${fmt(x0 + k * h, 3)}.` })
  }
  const summary: Record<string, string> = {}
  sols.forEach((s) => { summary[s.m] = fmt(s.pts[s.pts.length - 1][1], 5) })
  if (ex) summary.exact = fmt(ex(xEnd), 5)
  return trace(620, 320, frames, summary)
}

// ── Gaussian elimination ────────────────────────────────────────────────────

function gaussRun(p: Params) {
  const A = prows(p, 'matrix', [['2', '1', '-1', '8'], ['-3', '-1', '2', '-11'], ['-2', '1', '2', '-3']]).map((r) => r.map(Number))
  const n = A.length
  if (A.some((r) => r.length !== n + 1 || r.some((v) => !Number.isFinite(v)))) throw new LabError('give an n × (n+1) augmented matrix, rows separated by ;')
  const pivoting = pstr(p, 'pivoting', 'partial') === 'partial'
  const M = A.map((r) => [...r])
  const snaps: { M: number[][]; note: string; row?: number; col?: number }[] = [{ M: M.map((r) => [...r]), note: `Augmented matrix [A | b]. Forward elimination will zero everything below the diagonal${pivoting ? ', choosing the largest pivot in each column (partial pivoting)' : ''}.` }]
  for (let c = 0; c < n; c++) {
    if (pivoting) { let m = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[m][c])) m = r; if (m !== c) { [M[c], M[m]] = [M[m], M[c]]; snaps.push({ M: M.map((r) => [...r]), note: `Pivot: swap row ${c + 1} with row ${m + 1} (${fmt(M[c][c], 4)} is the largest entry in column ${c + 1}).`, row: c, col: c }) } }
    if (Math.abs(M[c][c]) < 1e-12) throw new LabError(`zero pivot in column ${c + 1} — the system is singular or needs row exchanges`)
    for (let r = c + 1; r < n; r++) { const m = M[r][c] / M[c][c]; if (m === 0) continue; for (let k = c; k <= n; k++) M[r][k] -= m * M[c][k]; snaps.push({ M: M.map((q) => [...q]), note: `R${r + 1} ← R${r + 1} − (${fmt(m, 4)})·R${c + 1}: multiplier m = ${fmt(M[r][c] + m * M[c][c], 4)}/${fmt(M[c][c], 4)}.`, row: r, col: c }) }
  }
  const x = Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; snaps.push({ M: M.map((r) => [...r]), note: `Back-substitution: x${i + 1} = (${fmt(M[i][n], 4)}${i < n - 1 ? ' − known terms' : ''}) / ${fmt(M[i][i], 4)} = ${fmt(x[i], 6)}.`, row: i }) }
  const W = 560, H = 60 + n * 30 + 60
  const frames: Frame[] = snaps.map((s, k) => {
    const d: Prim[] = [heading(20, 14, `Gaussian elimination ${pivoting ? 'with partial pivoting' : ''}`)]
    s.M.forEach((r, i) => r.forEach((v, j) => d.push(box(30 + j * 62 + (j === n ? 10 : 0), 34 + i * 30, 58, 26, fmt(v, 4), s.row === i ? 'blue' : s.col === j && s.row !== undefined && i >= (s.col ?? 0) ? 'amber' : 'idle'))))
    if (k >= snaps.length - n) { const solved = snaps.length - k; x.slice(n - solved).forEach((v, i) => d.push(txt(30, 40 + n * 30 + 20 + i * 18, `x${n - solved + i + 1} = ${fmt(v, 6)}`, { size: 12, mono: true, tone: 'mint' }))) }
    return { draw: d, note: s.note }
  })
  return trace(W, H + n * 18, frames, { solution: x.map((v) => fmt(v, 6)).join(' ') })
}

// ── Jacobi / Gauss–Seidel ───────────────────────────────────────────────────

function iterRun(p: Params) {
  const A = prows(p, 'matrix', [['10', '-1', '2', '6'], ['-1', '11', '-1', '25'], ['2', '-1', '10', '-11']]).map((r) => r.map(Number))
  const n = A.length, method = pstr(p, 'method', 'seidel'), iters = pnum(p, 'iterations', 8)
  if (A.some((r) => r.length !== n + 1)) throw new LabError('give an n × (n+1) augmented matrix')
  const dominant = A.every((r, i) => Math.abs(r[i]) > r.slice(0, n).reduce((s, v, j) => (j === i ? s : s + Math.abs(v)), 0))
  let x = Array(n).fill(0)
  const hist = [x]
  for (let k = 0; k < iters; k++) {
    const nx = [...x]
    for (let i = 0; i < n; i++) { let s = A[i][n]; for (let j = 0; j < n; j++) if (j !== i) s -= A[i][j] * (method === 'seidel' ? nx[j] : x[j]); nx[i] = s / A[i][i] }
    x = nx; hist.push(x)
  }
  const W = 560, H = 300
  const err = hist.map((h) => Math.max(...h.map((v, i) => Math.abs(v - hist[hist.length - 1][i]))))
  const frames: Frame[] = hist.map((h, k) => {
    const d: Prim[] = [heading(20, 14, `${method === 'seidel' ? 'Gauss–Seidel' : 'Jacobi'} · diagonally dominant: ${dominant ? 'yes (convergence guaranteed)' : 'NO (may diverge)'}`)]
    d.push(txt(30, 44, 'iter', { size: 10, bold: true, tone: 'dim' }), ...h.map((_, i) => txt(90 + i * 110, 44, `x${i + 1}`, { size: 10, bold: true, tone: 'dim', anchor: 'middle' })))
    hist.slice(0, k + 1).slice(-11).forEach((row, ri, arr) => { const it = k - arr.length + 1 + ri; d.push(txt(30, 66 + ri * 20, String(it), { size: 11.5, mono: true, tone: ri === arr.length - 1 ? 'blue' : 'dim' }), ...row.map((v, i) => txt(90 + i * 110, 66 + ri * 20, fmt(v, 6), { size: 11.5, mono: true, anchor: 'middle', tone: ri === arr.length - 1 ? 'blue' : 'idle' }))) })
    return { draw: d, note: k === 0 ? 'Start from x = 0. Each unknown is solved from its own equation using the latest values of the others.' : `Iteration ${k}: ${method === 'seidel' ? 'each new value is used immediately' : 'every unknown uses only the previous iterate'}. Largest change from the final answer: ${err[k].toExponential(1)}.` }
  })
  return trace(W, H, frames, { x: hist[hist.length - 1].map((v) => fmt(v, 5)).join(' '), dominant: dominant ? 'yes' : 'no' })
}

// ── Interpolation ───────────────────────────────────────────────────────────

function interpRun(p: Params) {
  const pts = prows(p, 'points', [['0', '1'], ['1', '3'], ['2', '2'], ['3', '5']]).map((r) => r.map(Number))
  if (pts.length < 2 || pts.some((r) => r.length !== 2 || r.some((v) => !Number.isFinite(v)))) throw new LabError('points look like 0,1;1,3;2,2 (x,y pairs)')
  const xq = pnum(p, 'at', 1.5)
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), n = pts.length
  const lag = (x: number) => ys.reduce((s, y, i) => s + y * xs.reduce((pr, xj, j) => (j === i ? pr : (pr * (x - xj)) / (xs[i] - xj)), 1), 0)
  // divided differences
  const dd: number[][] = [ys.slice()]
  for (let k = 1; k < n; k++) dd.push(Array.from({ length: n - k }, (_, i) => (dd[k - 1][i + 1] - dd[k - 1][i]) / (xs[i + k] - xs[i])))
  const coef = dd.map((r) => r[0])
  const newton = (x: number) => coef.reduce((s, c, k) => s + c * xs.slice(0, k).reduce((pr, xj) => pr * (x - xj), 1), 0)
  const lo = Math.min(...xs) - 0.3, hi = Math.max(...xs) + 0.3
  const grid = Array.from({ length: 60 }, (_, i) => lag(lo + ((hi - lo) * i) / 59))
  const pl = makePlot(40, 30, 380, 240, lo, hi, Math.min(...grid, ...ys), Math.max(...grid, ...ys))
  const frames: Frame[] = []
  for (let k = 1; k <= n; k++) {
    const sub = xs.slice(0, k), suby = ys.slice(0, k)
    const partial = (x: number) => suby.reduce((s, y, i) => s + y * sub.reduce((pr, xj, j) => (j === i ? pr : (pr * (x - xj)) / (sub[i] - xj)), 1), 0)
    const d: Prim[] = [heading(20, 14, 'Polynomial interpolation'), ...pl.axes, pl.curve(partial, 'blue', 2)]
    pts.forEach((q, i) => d.push(dot(pl.X(q[0]), pl.Y(q[1]), 4.5, undefined, i < k ? 'amber' : 'dim', { solid: true })))
    d.push(txt(440, 60, `${k} point${k > 1 ? 's' : ''} → degree ${k - 1}`, { size: 12, mono: true, bold: true }))
    if (k === n) d.push(dot(pl.X(xq), pl.Y(lag(xq)), 5, undefined, 'mint', { solid: true }), txt(440, 90, `P(${xq}) = ${fmt(lag(xq), 5)}`, { size: 12.5, mono: true, tone: 'mint' }), txt(440, 116, `Newton form c = [${coef.map((c) => fmt(c, 3)).join(', ')}]`, { size: 10.5, mono: true, tone: 'violet' }))
    frames.push({ draw: d, note: k === 1 ? 'One point fixes a constant; every extra point raises the degree by one so the curve is forced through all of them.' : `The unique polynomial of degree ${k - 1} through the first ${k} points.` })
  }
  return trace(620, 310, frames, { value: fmt(lag(xq), 5), newtonValue: fmt(newton(xq), 5), degree: String(n - 1) })
}

// ── 1-D heat conduction (explicit finite differences) ───────────────────────

function heatRun(p: Params) {
  const n = pnum(p, 'nodes', 11), r = pnum(p, 'r', 0.25), steps = pnum(p, 'steps', 60), TL = pnum(p, 'left', 100), TR = pnum(p, 'right', 0)
  if (n < 5 || n > 41) throw new LabError('nodes must be 5–41')
  if (r > 0.5) throw new LabError(`r = αΔt/Δx² = ${r} > 0.5: the explicit scheme is unstable — it would blow up`)
  let u = Array(n).fill(0); u[0] = TL; u[n - 1] = TR
  const hist = [u]
  for (let s = 0; s < steps; s++) { const v = [...u]; for (let i = 1; i < n - 1; i++) v[i] = u[i] + r * (u[i - 1] - 2 * u[i] + u[i + 1]); u = v; hist.push(u) }
  const pl = makePlot(40, 30, 420, 230, 0, 1, Math.min(0, TL, TR), Math.max(TL, TR, 1) * 1.05)
  const shown = [0, 1, 2, 5, 10, 20, 40, steps].filter((s) => s <= steps)
  const frames: Frame[] = [...new Set(shown)].map((s) => {
    const d: Prim[] = [heading(20, 14, `Heat conduction · r = αΔt/Δx² = ${r} · ${n} nodes`), ...pl.axes]
    for (const q of [0, 1, 2, 5, 10, 20, 40, steps].filter((v) => v <= s)) d.push(poly(hist[q].map((v, i) => [pl.X(i / (n - 1)), pl.Y(v)]), q === s ? 'rose' : 'dim', { w: q === s ? 2.4 : 1 }))
    d.push(poly(hist[s].map((v, i) => [pl.X(i / (n - 1)), pl.Y(v)]), 'rose', { w: 2.4 }))
    d.push(txt(480, 60, `step ${s}`, { size: 13, mono: true, bold: true }), txt(480, 84, `mid-rod ${fmt(hist[s][(n - 1) >> 1], 2)}°`, { size: 12, mono: true, tone: 'amber' }))
    return { draw: d, note: s === 0 ? 'Both ends are held at fixed temperatures; the rod starts at 0. Each interior node moves toward the average of its neighbours.' : `After ${s} time steps the profile has relaxed toward the straight line between the end temperatures (steady state).` }
  })
  return trace(640, 300, frames, { mid: fmt(hist[steps][(n - 1) >> 1], 3), steadyMid: fmt((TL + TR) / 2, 3) })
}

// ── Gradient descent ────────────────────────────────────────────────────────

function gdRun(p: Params) {
  const src = pstr(p, 'f', 'x^2 - 4*x + 5'), f = fx(src)
  const lr = pnum(p, 'lr', 0.2), x0 = pnum(p, 'x0', -1), steps = pnum(p, 'steps', 15), lo = pnum(p, 'xmin', -2), hi = pnum(p, 'xmax', 6)
  const xs = [x0]
  for (let i = 0; i < steps; i++) { const x = xs[i]; const g = deriv(f, x); xs.push(x - lr * g); if (!Number.isFinite(xs[xs.length - 1]) || Math.abs(xs[xs.length - 1]) > 1e6) { xs.pop(); break } }
  const ys = Array.from({ length: 80 }, (_, i) => f(lo + ((hi - lo) * i) / 79))
  const pl = makePlot(40, 30, 400, 240, lo, hi, Math.min(...ys), Math.max(...ys.filter((v) => v < Math.min(...ys) + 60)))
  const frames: Frame[] = xs.map((x, k) => {
    const g = deriv(f, x)
    const d: Prim[] = [heading(20, 14, `Gradient descent on f(x) = ${src} · learning rate ${lr}`), ...pl.axes, pl.curve(f, 'blue', 2)]
    for (let i = 0; i < k; i++) d.push(dot(pl.X(xs[i]), pl.Y(f(xs[i])), 3, undefined, 'mint', { solid: true }), line(pl.X(xs[i]), pl.Y(f(xs[i])), pl.X(xs[i + 1]), pl.Y(f(xs[i + 1])), 'mint', { dash: true, w: 1 }))
    d.push(dot(pl.X(x), pl.Y(f(x)), 5.5, undefined, 'amber', { solid: true }), line(pl.X(x - 0.6), pl.Y(f(x) - 0.6 * g), pl.X(x + 0.6), pl.Y(f(x) + 0.6 * g), 'amber', { w: 1.4 }))
    d.push(txt(460, 60, `step ${k}`, { size: 13, mono: true, bold: true }), txt(460, 84, `x = ${fmt(x, 5)}`, { size: 12, mono: true }), txt(460, 104, `f(x) = ${fmt(f(x), 5)}`, { size: 12, mono: true }), txt(460, 124, `f′(x) = ${fmt(g, 5)}`, { size: 12, mono: true, tone: 'amber' }))
    return { draw: d, note: k === 0 ? 'Repeatedly step downhill: x ← x − η·f′(x). The slope decides the direction and how far to go.' : `x ← ${fmt(xs[k - 1], 4)} − ${lr}·${fmt(deriv(f, xs[k - 1]), 4)} = ${fmt(x, 5)}.` }
  })
  return trace(640, 310, frames, { x: fmt(xs[xs.length - 1], 5), fx: fmt(f(xs[xs.length - 1]), 5), diverged: xs.length < steps + 1 ? 'yes' : 'no' })
}

// ── Regression ──────────────────────────────────────────────────────────────

export function linreg(pts: number[][]) {
  const n = pts.length, mx = pts.reduce((s, q) => s + q[0], 0) / n, my = pts.reduce((s, q) => s + q[1], 0) / n
  const sxx = pts.reduce((s, q) => s + (q[0] - mx) ** 2, 0), sxy = pts.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0), syy = pts.reduce((s, q) => s + (q[1] - my) ** 2, 0)
  const b1 = sxy / sxx, b0 = my - b1 * mx
  const sse = pts.reduce((s, q) => s + (q[1] - (b0 + b1 * q[0])) ** 2, 0)
  return { b0, b1, r2: 1 - sse / syy, r: sxy / Math.sqrt(sxx * syy), sse, mx, my }
}
function regressRun(p: Params) {
  const pts = prows(p, 'points', [['1', '2'], ['2', '3'], ['3', '5'], ['4', '4'], ['5', '6']]).map((r) => r.map(Number))
  if (pts.length < 3 || pts.some((r) => r.length !== 2 || r.some((v) => !Number.isFinite(v)))) throw new LabError('give at least 3 points as x,y;x,y;…')
  const { b0, b1, r2, r, sse, mx, my } = linreg(pts)
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
  const lo = Math.min(...xs) - 0.5, hi = Math.max(...xs) + 0.5
  const pl = makePlot(40, 30, 380, 240, lo, hi, Math.min(...ys, b0 + b1 * lo) - 0.5, Math.max(...ys, b0 + b1 * hi) + 0.5)
  const base = (): Prim[] => [heading(20, 14, 'Least-squares line'), ...pl.axes, ...pts.map((q) => dot(pl.X(q[0]), pl.Y(q[1]), 4.5, undefined, 'blue', { solid: true }))]
  const frames: Frame[] = [
    { draw: base(), note: 'Scatter of the data. We want the line ŷ = b₀ + b₁x that makes the vertical errors as small as possible.' },
    { draw: [...base(), dot(pl.X(mx), pl.Y(my), 6, undefined, 'amber', { solid: true }), txt(440, 60, `mean point (${fmt(mx, 2)}, ${fmt(my, 2)})`, { size: 11.5, mono: true, tone: 'amber' })], note: 'The least-squares line always passes through the mean point (x̄, ȳ).' },
    { draw: [...base(), pl.curve((x) => b0 + b1 * x, 'mint', 2.4), txt(440, 60, `b₁ = Sxy/Sxx = ${fmt(b1, 4)}`, { size: 12, mono: true }), txt(440, 84, `b₀ = ȳ − b₁x̄ = ${fmt(b0, 4)}`, { size: 12, mono: true })], note: 'Slope = Σ(x−x̄)(y−ȳ) / Σ(x−x̄)²; the intercept follows from the mean point.' },
    { draw: [...base(), pl.curve((x) => b0 + b1 * x, 'mint', 2.4), ...pts.map((q) => line(pl.X(q[0]), pl.Y(q[1]), pl.X(q[0]), pl.Y(b0 + b1 * q[0]), 'rose', { w: 1.6 })), txt(440, 60, `SSE = ${fmt(sse, 4)}`, { size: 12, mono: true, tone: 'rose' }), txt(440, 84, `R² = ${fmt(r2, 4)}`, { size: 12, mono: true, tone: 'mint' }), txt(440, 108, `r = ${fmt(r, 4)}`, { size: 12, mono: true })], note: 'The red residuals are what the fit minimises (sum of squares). R² is the fraction of the variation in y that the line explains.' },
  ]
  return trace(620, 310, frames, { slope: fmt(b1, 4), intercept: fmt(b0, 4), r2: fmt(r2, 4), r: fmt(r, 4) })
}

// ── Distributions ───────────────────────────────────────────────────────────

const lgamma = (n: number) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s }
export const binomPmf = (n: number, k: number, p: number) => Math.exp(lgamma(n) - lgamma(k) - lgamma(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p))
export const poissonPmf = (lam: number, k: number) => Math.exp(-lam + k * Math.log(lam) - lgamma(k))
const normPdf = (x: number, mu: number, s: number) => Math.exp(-((x - mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))
const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y }
export const normCdf = (x: number, mu = 0, s = 1) => 0.5 * (1 + erf((x - mu) / (s * Math.SQRT2)))

function distRun(p: Params) {
  const kind = pstr(p, 'kind', 'binomial'), prob = pnum(p, 'p', 0.5), lam = pnum(p, 'lambda', 4), mu = pnum(p, 'mu', 0), sd = pnum(p, 'sigma', 1)
  const ns = pnums(p, 'n', kind === 'binomial' ? [5, 10, 30] : [10])
  const from = pnum(p, 'from', NaN), to = pnum(p, 'to', NaN)
  const frames: Frame[] = []
  const summary: Record<string, string> = {}
  for (const n of ns) {
    const d: Prim[] = []
    if (kind === 'binomial' || kind === 'poisson') {
      const m = kind === 'binomial' ? n : Math.ceil(lam * 3 + 6)
      const pm = (k: number) => (kind === 'binomial' ? binomPmf(n, k, prob) : poissonPmf(lam, k))
      const vals = Array.from({ length: m + 1 }, (_, k) => pm(k))
      const pl = makePlot(40, 30, 420, 230, -0.5, m + 0.5, 0, Math.max(...vals) * 1.15)
      d.push(heading(20, 14, kind === 'binomial' ? `Binomial(n = ${n}, p = ${prob}) — mean ${fmt(n * prob, 2)}, sd ${fmt(Math.sqrt(n * prob * (1 - prob)), 3)}` : `Poisson(λ = ${lam})`), ...pl.axes)
      const bw = pl.w / (m + 1)
      vals.forEach((v, k) => { const inr = Number.isFinite(from) && k >= from && k <= to; d.push({ k: 'rect', x: pl.X(k) - bw / 2 + 1, y: pl.Y(v), w: Math.max(1, bw - 2), h: pl.y0 + pl.h - pl.Y(v), tone: inr ? 'mint' : 'blue', r: 1 }) })
      if (kind === 'binomial') d.push(pl.curve((x) => normPdf(x, n * prob, Math.sqrt(n * prob * (1 - prob))), 'amber', 2))
      if (Number.isFinite(from)) { const s = vals.reduce((a, v, k) => (k >= from && k <= to ? a + v : a), 0); d.push(txt(480, 70, `P(${from} ≤ X ≤ ${to})`, { size: 11.5, mono: true }), txt(480, 92, `= ${fmt(s, 5)}`, { size: 13, mono: true, bold: true, tone: 'mint' })); summary.prob = fmt(s, 5) }
      summary[`mean_${n}`] = fmt(kind === 'binomial' ? n * prob : lam, 3)
    } else {
      const lo = mu - 4 * sd, hi = mu + 4 * sd
      const pl = makePlot(40, 30, 420, 230, lo, hi, 0, normPdf(mu, mu, sd) * 1.15)
      d.push(heading(20, 14, `Normal(μ = ${mu}, σ = ${sd})`), ...pl.axes)
      if (Number.isFinite(from)) { const pts: number[][] = [[pl.X(from), pl.Y(0)]]; for (let i = 0; i <= 60; i++) { const x = from + ((to - from) * i) / 60; pts.push([pl.X(x), pl.Y(normPdf(x, mu, sd))]) } pts.push([pl.X(to), pl.Y(0)]); d.push(poly(pts, 'mint', { closed: true, fill: true, w: 1 })); const s = normCdf(to, mu, sd) - normCdf(from, mu, sd); d.push(txt(480, 70, `P(${from} < X < ${to})`, { size: 11.5, mono: true }), txt(480, 92, `= ${fmt(s, 5)}`, { size: 13, mono: true, bold: true, tone: 'mint' }), txt(480, 114, `z: ${fmt((from - mu) / sd, 3)} → ${fmt((to - mu) / sd, 3)}`, { size: 11.5, mono: true, tone: 'amber' })); summary.prob = fmt(s, 5) }
      d.push(pl.curve((x) => normPdf(x, mu, sd), 'blue', 2.4))
    }
    frames.push({ draw: d, note: kind === 'binomial' ? `n = ${n}: ${n < 15 ? 'still lumpy' : 'the bars hug the normal curve (amber) — the normal approximation works when np and n(1−p) are both large'}.` : 'Shaded area = probability.' })
  }
  return trace(640, 290, frames, summary)
}

// ── Bayes ───────────────────────────────────────────────────────────────────

function bayesRun(p: Params) {
  const prior = pnum(p, 'prior', 0.01), sens = pnum(p, 'sensitivity', 0.9), spec = pnum(p, 'specificity', 0.91), N = pnum(p, 'population', 1000)
  const sick = N * prior, healthy = N - sick, tp = sick * sens, fn = sick - tp, fp = healthy * (1 - spec), tn = healthy - fp
  const post = tp / (tp + fp)
  const W = 620, H = 320
  const box2 = (x: number, y: number, w: number, label: string, v: number, tone: Tone): Prim => box(x, y, w, 38, `${fmt(v, 2)}`, tone, label)
  const frames: Frame[] = [
    { draw: [heading(20, 14, `${N} people`), box2(230, 34, 160, 'everyone', N, 'idle')], note: `Think of ${N} people. Bayes' theorem is just counting who ends up in which box.` },
    { draw: [heading(20, 14, `${N} people`), box2(230, 34, 160, 'everyone', N, 'idle'), line(310, 72, 160, 110, 'dim', { arrow: true }), line(310, 72, 460, 110, 'dim', { arrow: true }), box2(80, 110, 160, `have the condition  (prior ${fmt(prior * 100, 2)}%)`, sick, 'rose'), box2(380, 110, 160, 'do not', healthy, 'idle')], note: `A prior of ${fmt(prior * 100, 2)}% means ${fmt(sick, 2)} of them have the condition.` },
    { draw: [heading(20, 14, `${N} people`), box2(80, 34, 160, 'condition', sick, 'rose'), box2(380, 34, 160, 'no condition', healthy, 'idle'), line(160, 72, 100, 120, 'dim', { arrow: true }), line(160, 72, 220, 120, 'dim', { arrow: true }), line(460, 72, 400, 120, 'dim', { arrow: true }), line(460, 72, 520, 120, 'dim', { arrow: true }), box2(20, 120, 130, `test + (sens ${fmt(sens * 100, 1)}%)`, tp, 'amber'), box2(160, 120, 130, 'test −', fn, 'dim'), box2(330, 120, 130, `test + (1−spec)`, fp, 'amber'), box2(470, 120, 130, 'test −', tn, 'dim')], note: 'The test splits each group: true positives among the sick, false positives among the healthy.' },
    { draw: [heading(20, 14, 'Given a positive test…'), box2(20, 34, 130, 'true positives', tp, 'mint'), box2(160, 34, 130, 'false positives', fp, 'rose'), txt(20, 110, `P(condition | +) = TP / (TP + FP) = ${fmt(tp, 2)} / ${fmt(tp + fp, 2)} = ${fmt(post * 100, 2)}%`, { size: 14, mono: true, bold: true, tone: 'mint' }), txt(20, 140, `Even a fairly accurate test gives a modest posterior when the prior is small.`, { size: 12, tone: 'dim' })], note: 'Condition on a positive result: only the two amber boxes remain. The posterior is the true-positive share of them.' },
  ]
  return trace(W, H, frames, { posterior: fmt(post, 4), truePositives: fmt(tp, 2), falsePositives: fmt(fp, 2) })
}

// ── CLT ─────────────────────────────────────────────────────────────────────

function cltRun(p: Params) {
  const pop = pstr(p, 'population', 'exponential'), n = pnum(p, 'n', 30), reps = pnum(p, 'samples', 400)
  const r = rng(pnum(p, 'seed', 7))
  const draw1 = () => (pop === 'uniform' ? r() : pop === 'exponential' ? -Math.log(1 - r()) : pop === 'coin' ? (r() < 0.5 ? 0 : 1) : (() => { throw new LabError('population is uniform, exponential or coin') })())
  const mu = pop === 'uniform' ? 0.5 : pop === 'exponential' ? 1 : 0.5, sigma = pop === 'uniform' ? Math.sqrt(1 / 12) : pop === 'exponential' ? 1 : 0.5
  const means: number[] = []
  for (let i = 0; i < reps; i++) { let s = 0; for (let j = 0; j < n; j++) s += draw1(); means.push(s / n) }
  const se = sigma / Math.sqrt(n), lo = mu - 4 * se, hi = mu + 4 * se, bins = 24
  const pl = makePlot(40, 30, 420, 230, lo, hi, 0, 1)
  const checkpoints = [10, 50, 150, reps].filter((v) => v <= reps)
  const frames: Frame[] = checkpoints.map((m) => {
    const cnt = Array(bins).fill(0); means.slice(0, m).forEach((v) => { const b = Math.floor(((v - lo) / (hi - lo)) * bins); if (b >= 0 && b < bins) cnt[b]++ })
    const dens = cnt.map((c) => c / (m * ((hi - lo) / bins)))
    const top = Math.max(...dens, normPdf(mu, mu, se)) * 1.1
    const p2 = makePlot(40, 30, 420, 230, lo, hi, 0, top)
    const d: Prim[] = [heading(20, 14, `Means of ${m} samples of size ${n} from a ${pop} population`), ...p2.axes]
    dens.forEach((v, b) => d.push({ k: 'rect', x: p2.X(lo + (b * (hi - lo)) / bins) + 1, y: p2.Y(v), w: p2.w / bins - 2, h: p2.y0 + p2.h - p2.Y(v), tone: 'blue', r: 1 }))
    d.push(p2.curve((x) => normPdf(x, mu, se), 'amber', 2))
    const mm = means.slice(0, m).reduce((a, b) => a + b, 0) / m, sd = Math.sqrt(means.slice(0, m).reduce((a, b) => a + (b - mm) ** 2, 0) / m)
    d.push(txt(480, 60, `mean of means ${fmt(mm, 3)}`, { size: 11.5, mono: true }), txt(480, 82, `sd of means ${fmt(sd, 3)}`, { size: 11.5, mono: true, tone: 'amber' }), txt(480, 104, `σ/√n = ${fmt(se, 3)}`, { size: 11.5, mono: true, tone: 'dim' }))
    void pl
    return { draw: d, note: `Whatever the population's shape, the histogram of sample means approaches the normal curve (amber) with sd σ/√n. Here ${m} sample means are plotted.` }
  })
  const mm = means.reduce((a, b) => a + b, 0) / reps, sd = Math.sqrt(means.reduce((a, b) => a + (b - mm) ** 2, 0) / reps)
  return trace(640, 290, frames, { meanOfMeans: fmt(mm, 3), sdOfMeans: fmt(sd, 3), theorySd: fmt(se, 3) })
}

// ── Confidence intervals ────────────────────────────────────────────────────

function confRun(p: Params) {
  const mu = pnum(p, 'mu', 50), sigma = pnum(p, 'sigma', 10), n = pnum(p, 'n', 25), N = pnum(p, 'intervals', 40), z = pnum(p, 'zcrit', 1.96)
  const r = rng(pnum(p, 'seed', 3))
  const half = (z * sigma) / Math.sqrt(n)
  const ints = Array.from({ length: N }, () => { let s = 0; for (let j = 0; j < n; j++) s += mu + sigma * gauss(r); const m = s / n; return { m, lo: m - half, hi: m + half, hit: m - half <= mu && mu <= m + half } })
  const pl = makePlot(40, 30, 500, 250, mu - 3 * half, mu + 3 * half, 0, N + 1, { yticks: 4 })
  const frames: Frame[] = [10, 20, N].filter((v, i, a) => v <= N && a.indexOf(v) === i).map((k) => {
    const d: Prim[] = [heading(20, 14, `${k} confidence intervals · z = ${z} (≈ ${z === 1.96 ? 95 : z === 2.576 ? 99 : z === 1.645 ? 90 : '?'}%)`), ...pl.axes, line(pl.X(mu), pl.y0, pl.X(mu), pl.y0 + pl.h, 'blue', { w: 1.6 })]
    ints.slice(0, k).forEach((iv, i) => { const y = pl.y0 + 8 + (i * (pl.h - 16)) / Math.max(1, N - 1); d.push(line(pl.X(iv.lo), y, pl.X(iv.hi), y, iv.hit ? 'mint' : 'rose', { w: 2 }), dot(pl.X(iv.m), y, 2.5, undefined, iv.hit ? 'mint' : 'rose', { solid: true })) })
    const hits = ints.slice(0, k).filter((i) => i.hit).length
    d.push(txt(560, 70, `${hits}/${k} contain μ`, { size: 12.5, mono: true, bold: true, tone: 'mint' }), txt(560, 94, `${fmt((hits / k) * 100, 1)}%`, { size: 12, mono: true }))
    return { draw: d, note: `Each bar is x̄ ± ${fmt(half, 2)} from a fresh sample of ${n}. The blue line is the true mean μ — about ${z === 1.96 ? '95' : 'the stated share'} % of intervals should cross it; red ones miss.` }
  })
  return trace(680, 320, frames, { coverage: fmt((ints.filter((i) => i.hit).length / N) * 100, 1), halfWidth: fmt(half, 3) })
}

export const NUM_ENGINES: EngineDef[] = [
  { id: 'rootfind', label: 'Root finding', group: G_NUM, blurb: 'Bisection, false position, Newton–Raphson and secant on any f(x).',
    params: [{ name: 'method', label: 'Method', hint: 'bisection falsi newton secant', def: 'bisection', options: ['bisection', 'falsi', 'newton', 'secant'] }, { name: 'f', label: 'f(x)', hint: 'e.g. x^3 - x - 2, cos(x) - x', def: 'x^3 - x - 2' }, { name: 'a', label: 'a', hint: 'bracket start / first guess', def: '1' }, { name: 'b', label: 'b', hint: 'bracket end / second guess', def: '2' }, { name: 'x0', label: 'x₀', hint: 'Newton start', def: '1.5' }, { name: 'tol', label: 'Tolerance', hint: 'stop when smaller', def: '0.0001' }], run: rootRun },
  { id: 'integrate', label: 'Numerical integration', group: G_NUM, blurb: 'Trapezoid, Simpson and midpoint rules: watch the error fall as n grows.',
    params: [{ name: 'rule', label: 'Rule', hint: 'trapezoid simpson midpoint', def: 'trapezoid', options: ['trapezoid', 'simpson', 'midpoint'] }, { name: 'f', label: 'f(x)', hint: 'integrand', def: 'sin(x)' }, { name: 'a', label: 'a', hint: 'lower limit', def: '0' }, { name: 'b', label: 'b', hint: 'upper limit', def: '3.14159265' }, { name: 'n', label: 'Intervals', hint: 'up to 200', def: '8' }], run: integRun },
  { id: 'ode', label: 'ODE solvers', group: G_NUM, blurb: 'Euler, Heun and Runge–Kutta 4 against the exact solution.',
    params: [{ name: 'f', label: "y' = f(x,y)", hint: 'e.g. x + y', def: 'x + y' }, { name: 'x0', label: 'x₀', hint: '', def: '0' }, { name: 'y0', label: 'y₀', hint: '', def: '1' }, { name: 'h', label: 'Step h', hint: '', def: '0.1' }, { name: 'xEnd', label: 'x end', hint: '', def: '1' }, { name: 'methods', label: 'Methods', hint: 'euler heun rk4', def: 'euler rk4' }, { name: 'exact', label: 'Exact y(x)', hint: 'optional', def: '2*exp(x) - x - 1', optional: true }], run: odeRun },
  { id: 'gauss', label: 'Gaussian elimination', group: G_NUM, blurb: 'Forward elimination, pivoting and back-substitution.',
    params: [{ name: 'matrix', label: 'Augmented [A|b]', hint: 'rows separated by ;', def: '2,1,-1,8;-3,-1,2,-11;-2,1,2,-3', long: true }, { name: 'pivoting', label: 'Pivoting', hint: 'partial | none', def: 'partial', options: ['partial', 'none'] }], run: gaussRun },
  { id: 'iterative', label: 'Jacobi & Gauss–Seidel', group: G_NUM, blurb: 'Iterate to the solution of a linear system; diagonal dominance decides convergence.',
    params: [{ name: 'method', label: 'Method', hint: 'jacobi | seidel', def: 'seidel', options: ['jacobi', 'seidel'] }, { name: 'matrix', label: 'Augmented [A|b]', hint: 'rows separated by ;', def: '10,-1,2,6;-1,11,-1,25;2,-1,10,-11', long: true }, { name: 'iterations', label: 'Iterations', hint: '', def: '8' }], run: iterRun },
  { id: 'interp', label: 'Interpolation', group: G_NUM, blurb: 'The unique polynomial through your points (Lagrange = Newton).',
    params: [{ name: 'points', label: 'Points', hint: 'x,y;x,y;…', def: '0,1;1,3;2,2;3,5' }, { name: 'at', label: 'Evaluate at', hint: '', def: '1.5' }], run: interpRun },
  { id: 'heat1d', label: '1-D heat conduction (finite differences)', group: G_NUM, blurb: 'Explicit scheme for u_t = α u_xx: stability needs r ≤ ½.',
    params: [{ name: 'nodes', label: 'Nodes', hint: '5–41', def: '11' }, { name: 'r', label: 'r = αΔt/Δx²', hint: 'must be ≤ 0.5', def: '0.25' }, { name: 'steps', label: 'Time steps', hint: '', def: '60' }, { name: 'left', label: 'Left T', hint: '', def: '100' }, { name: 'right', label: 'Right T', hint: '', def: '0' }], run: heatRun },
  { id: 'gd', label: 'Gradient descent', group: G_STAT, blurb: 'Step downhill on f(x): see convergence, oscillation and divergence as the learning rate changes.',
    params: [{ name: 'f', label: 'f(x)', hint: 'any expression in x', def: 'x^2 - 4*x + 5' }, { name: 'lr', label: 'Learning rate', hint: '', def: '0.2' }, { name: 'x0', label: 'Start x₀', hint: '', def: '-1' }, { name: 'steps', label: 'Steps', hint: '', def: '15' }, { name: 'xmin', label: 'x min', hint: '', def: '-2' }, { name: 'xmax', label: 'x max', hint: '', def: '6' }], run: gdRun },
  { id: 'regression', label: 'Linear regression', group: G_STAT, blurb: 'Least squares: mean point, slope, residuals, R².',
    params: [{ name: 'points', label: 'Points', hint: 'x,y;x,y;…', def: '1,2;2,3;3,5;4,4;5,6' }], run: regressRun },
  { id: 'dist', label: 'Probability distributions', group: G_STAT, blurb: 'Binomial, Poisson and normal — shade a probability; watch binomial become normal.',
    params: [{ name: 'kind', label: 'Distribution', hint: 'binomial poisson normal', def: 'binomial', options: ['binomial', 'poisson', 'normal'] }, { name: 'n', label: 'n (list)', hint: 'binomial trials; several give several frames', def: '5 10 30' }, { name: 'p', label: 'p', hint: 'success probability', def: '0.5' }, { name: 'lambda', label: 'λ', hint: 'Poisson mean', def: '4' }, { name: 'mu', label: 'μ', hint: 'normal mean', def: '0' }, { name: 'sigma', label: 'σ', hint: 'normal sd', def: '1' }, { name: 'from', label: 'P from', hint: 'lower bound to shade', def: '', optional: true }, { name: 'to', label: 'P to', hint: 'upper bound', def: '', optional: true }], run: distRun },
  { id: 'bayes', label: "Bayes' theorem", group: G_STAT, blurb: 'Posterior probability by counting people: prior, sensitivity, specificity.',
    params: [{ name: 'prior', label: 'Prior', hint: 'P(condition)', def: '0.01' }, { name: 'sensitivity', label: 'Sensitivity', hint: 'P(+ | condition)', def: '0.9' }, { name: 'specificity', label: 'Specificity', hint: 'P(− | no condition)', def: '0.91' }, { name: 'population', label: 'Population', hint: '', def: '1000' }], run: bayesRun },
  { id: 'clt', label: 'Central limit theorem', group: G_STAT, blurb: 'The distribution of sample means becomes normal, whatever the population.',
    params: [{ name: 'population', label: 'Population', hint: 'uniform exponential coin', def: 'exponential', options: ['uniform', 'exponential', 'coin'] }, { name: 'n', label: 'Sample size', hint: '', def: '30' }, { name: 'samples', label: 'Samples', hint: '', def: '400' }, { name: 'seed', label: 'Seed', hint: '', def: '7' }], run: cltRun },
  { id: 'confint', label: 'Confidence intervals', group: G_STAT, blurb: 'Simulate many intervals: about 95% capture the true mean.',
    params: [{ name: 'mu', label: 'True μ', hint: '', def: '50' }, { name: 'sigma', label: 'σ', hint: '', def: '10' }, { name: 'n', label: 'Sample size', hint: '', def: '25' }, { name: 'intervals', label: 'Intervals', hint: '', def: '40' }, { name: 'zcrit', label: 'z', hint: '1.645 (90%), 1.96 (95%), 2.576 (99%)', def: '1.96' }, { name: 'seed', label: 'Seed', hint: '', def: '3' }], run: confRun },
]
