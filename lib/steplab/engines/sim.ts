// Simulation & modelling (ENCT 353): Monte Carlo, the M/M/1 queue as a
// discrete-event simulation, linear-congruential random numbers with tests,
// and Markov chains.

import type { EngineDef, Frame, Params, Prim } from '../types'
import { LabError, fmt, pnum, pnums, pstr, prows } from '../types'
import { box, dot, heading, line, makePlot, poly, toneAt, trace, txt } from '../draw'
import { rng } from '../expr'

const G = 'Simulation & modelling'

function mcRun(p: Params) {
  const N = pnum(p, 'points', 400), r = rng(pnum(p, 'seed', 11))
  if (N < 10 || N > 20000) throw new LabError('points must be 10–20000')
  const pts: { x: number; y: number; in: boolean }[] = []
  for (let i = 0; i < N; i++) { const x = r(), y = r(); pts.push({ x, y, in: x * x + y * y <= 1 }) }
  const est = (n: number) => (4 * pts.slice(0, n).filter((q) => q.in).length) / n
  const checkpoints = [...new Set([10, 50, 100, 200, 400, 1000, 4000, N].filter((v) => v <= N))]
  const S = 250, x0 = 30, y0 = 40
  const frames: Frame[] = checkpoints.map((n) => {
    const d: Prim[] = [heading(20, 14, 'Monte Carlo estimate of π'), { k: 'rect', x: x0, y: y0, w: S, h: S, tone: 'dim', r: 0 }]
    const arc: number[][] = []; for (let i = 0; i <= 40; i++) { const t = (i / 40) * (Math.PI / 2); arc.push([x0 + S * Math.cos(t), y0 + S - S * Math.sin(t)]) }
    d.push(poly(arc, 'violet', { w: 1.8 }))
    pts.slice(0, Math.min(n, 1200)).forEach((q) => d.push(dot(x0 + q.x * S, y0 + S - q.y * S, 1.6, undefined, q.in ? 'mint' : 'rose', { solid: true })))
    const e = est(n)
    d.push(txt(320, 70, `points  ${n}`, { size: 13, mono: true }), txt(320, 96, `inside  ${pts.slice(0, n).filter((q) => q.in).length}`, { size: 13, mono: true, tone: 'mint' }), txt(320, 130, `π ≈ 4 × inside/total`, { size: 12, mono: true, tone: 'dim' }), txt(320, 156, `  = ${fmt(e, 4)}`, { size: 16, mono: true, bold: true, tone: 'amber' }), txt(320, 184, `error ${fmt(Math.abs(e - Math.PI), 4)}`, { size: 12, mono: true, tone: 'rose' }), txt(320, 210, `expected error ~ ${fmt((Math.PI * Math.sqrt((1 - Math.PI / 4) / (Math.PI / 4))) / Math.sqrt(n) * 0.5, 3)}  (∝ 1/√n)`, { size: 10.5, mono: true, tone: 'dim' }))
    return { draw: d, note: `Throw ${n} random points at the unit square; the fraction inside the quarter circle estimates its area π/4. The error shrinks like 1/√n — 100× more points for 10× more accuracy.` }
  })
  return trace(640, 320, frames, { estimate: fmt(est(N), 4), error: fmt(Math.abs(est(N) - Math.PI), 4) })
}

// ── M/M/1 ───────────────────────────────────────────────────────────────────

export function mm1(lambda: number, mu: number, customers: number, seed: number) {
  const r = rng(seed), ex = (rate: number) => -Math.log(1 - r()) / rate
  const arr: number[] = [], svc: number[] = []
  let t = 0
  for (let i = 0; i < customers; i++) { t += ex(lambda); arr.push(t); svc.push(ex(mu)) }
  const start: number[] = [], depart: number[] = []
  for (let i = 0; i < customers; i++) { start.push(Math.max(arr[i], i ? depart[i - 1] : 0)); depart.push(start[i] + svc[i]) }
  const wait = arr.map((a, i) => start[i] - a)
  const T = depart[customers - 1]
  const busy = svc.reduce((a, b) => a + b, 0)
  // time-average number in system by event sweep
  const ev = [...arr.map((x) => ({ t: x, d: 1 })), ...depart.map((x) => ({ t: x, d: -1 }))].sort((a, b) => a.t - b.t)
  let n = 0, area = 0, last = 0
  const path: { t: number; n: number }[] = [{ t: 0, n: 0 }]
  for (const e of ev) { area += n * (e.t - last); last = e.t; n += e.d; path.push({ t: e.t, n }) }
  return { arr, start, depart, wait, util: busy / T, avgWait: wait.reduce((a, b) => a + b, 0) / customers, L: area / T, path, T }
}

function mm1Run(p: Params) {
  const lam = pnum(p, 'lambda', 0.8), mu = pnum(p, 'mu', 1), N = pnum(p, 'customers', 300), seed = pnum(p, 'seed', 5)
  if (lam >= mu) throw new LabError(`λ = ${lam} ≥ μ = ${mu}: the queue is unstable (ρ ≥ 1) and grows without bound`)
  const s = mm1(lam, mu, N, seed), rho = lam / mu
  const Wq = rho / (mu - lam), L = rho / (1 - rho)
  const shown = Math.min(60, N)
  const first = s.path.filter((q) => q.t <= s.depart[shown - 1] + 1e-9)
  const T = s.depart[shown - 1]
  const pl = makePlot(40, 30, 420, 170, 0, T, 0, Math.max(...first.map((q) => q.n)) + 1, { yticks: 4 })
  const stops = [5, 15, shown]
  const frames: Frame[] = stops.map((k) => {
    const tk = s.depart[k - 1]
    const pts: number[][] = []; let prev = 0
    for (const q of first.filter((q) => q.t <= tk)) { pts.push([pl.X(q.t), pl.Y(prev)], [pl.X(q.t), pl.Y(q.n)]); prev = q.n }
    pts.push([pl.X(tk), pl.Y(prev)])
    const d: Prim[] = [heading(20, 14, `M/M/1 queue · λ = ${lam}, μ = ${mu}, ρ = ${fmt(rho, 3)}`), ...pl.axes, poly(pts, 'blue', { w: 1.8 })]
    for (let i = 0; i < k; i++) d.push(line(pl.X(s.arr[i]), pl.y0 + pl.h + 22, pl.X(s.arr[i]), pl.y0 + pl.h + 32, 'mint', { w: 1.5 }), line(pl.X(s.depart[i]), pl.y0 + pl.h + 32, pl.X(s.depart[i]), pl.y0 + pl.h + 42, 'rose', { w: 1.5 }))
    d.push(txt(40, pl.y0 + pl.h + 58, 'green ticks: arrivals  ·  red ticks: departures  ·  curve: customers in system', { size: 10, tone: 'dim' }))
    d.push(txt(480, 60, `customers ${k}`, { size: 12, mono: true, bold: true }), txt(480, 84, `avg wait Wq ${fmt(s.wait.slice(0, k).reduce((a, b) => a + b, 0) / k, 2)}`, { size: 11.5, mono: true, tone: 'amber' }))
    return { draw: d, note: 'Interarrival and service times are exponential. Whenever the server is busy an arrival waits; the curve shows how many customers are in the system.' }
  })
  frames[frames.length - 1].draw.push(txt(480, 108, `theory Wq ${fmt(Wq, 2)}`, { size: 11.5, mono: true, tone: 'dim' }), txt(480, 132, `sim utilisation ${fmt(s.util, 3)}`, { size: 11.5, mono: true, tone: 'mint' }), txt(480, 152, `theory ρ  ${fmt(rho, 3)}`, { size: 11.5, mono: true, tone: 'dim' }), txt(480, 176, `sim L ${fmt(s.L, 2)}  (theory ${fmt(L, 2)})`, { size: 11.5, mono: true, tone: 'violet' }))
  return trace(640, 300, frames, { utilisation: fmt(s.util, 3), rho: fmt(rho, 3), avgWait: fmt(s.avgWait, 3), theoryWq: fmt(Wq, 3), avgInSystem: fmt(s.L, 3), theoryL: fmt(L, 3) })
}

// ── LCG & randomness tests ──────────────────────────────────────────────────

export function lcgSeq(a: number, c: number, m: number, seed: number, count: number): number[] {
  const out = [seed]; let x = seed
  for (let i = 0; i < count; i++) { x = (a * x + c) % m; out.push(x) }
  return out
}
function lcgRun(p: Params) {
  const a = pnum(p, 'a', 5), c = pnum(p, 'c', 3), m = pnum(p, 'm', 16), x0 = pnum(p, 'seed', 7), n = pnum(p, 'count', 64)
  if (m < 2 || m > 1e9) throw new LabError('m must be 2…1e9')
  const seq = lcgSeq(a, c, m, x0, Math.max(n, m + 1))
  let period = 0; const seen = new Map<number, number>(); for (let i = 0; i < seq.length; i++) { if (seen.has(seq[i])) { period = i - seen.get(seq[i])!; break } seen.set(seq[i], i) }
  const use = seq.slice(1, n + 1).map((v) => v / m)
  const bins = 8, cnt = Array(bins).fill(0); use.forEach((u) => cnt[Math.min(bins - 1, Math.floor(u * bins))]++)
  const expct = use.length / bins
  const chi = cnt.reduce((s, o) => s + (o - expct) ** 2 / expct, 0), crit = 14.067 // chi² 0.05, 7 dof
  const sorted = [...use].sort((x, y) => x - y)
  const D = Math.max(...sorted.map((u, i) => Math.max((i + 1) / sorted.length - u, u - i / sorted.length))), dcrit = 1.36 / Math.sqrt(sorted.length)
  const fullPeriod = period === m
  const W = 620, H = 320
  const frames: Frame[] = [
    { draw: [heading(20, 14, `X ← (${a}·X + ${c}) mod ${m},  seed ${x0}`), ...seq.slice(0, 22).map((v, i) => box(20 + (i % 11) * 52, 36 + Math.floor(i / 11) * 40, 48, 32, String(v), i === 0 ? 'blue' : 'idle'))], note: 'Each number is computed from the last. Divide by m to get a "uniform" value in [0, 1).' },
    { draw: [heading(20, 14, `Period`), ...seq.slice(0, 30).map((v, i) => box(20 + (i % 15) * 38, 36 + Math.floor(i / 15) * 34, 34, 28, String(v), period && i >= period ? 'rose' : 'idle')), txt(20, 130, period ? `sequence repeats after ${period} numbers ${fullPeriod ? '(full period = m ✓)' : `(full period would be ${m})`}` : `no repeat within ${seq.length} numbers`, { size: 13, mono: true, tone: fullPeriod ? 'mint' : 'amber' }), txt(20, 152, 'Hull–Dobell: full period needs gcd(c,m)=1, a−1 divisible by every prime factor of m (and by 4 if 4 | m).', { size: 10.5, tone: 'dim' })], note: 'A generator is a finite machine, so it must repeat. A long period is the first quality to demand.' },
    { draw: [heading(20, 14, 'Uniformity — χ² test (8 classes)'), ...(() => { const pl = makePlot(40, 36, 300, 170, 0, bins, 0, Math.max(...cnt, expct) * 1.2, { xticks: bins }); const o: Prim[] = [...pl.axes]; cnt.forEach((v, i) => o.push({ k: 'rect', x: pl.X(i) + 2, y: pl.Y(v), w: pl.w / bins - 4, h: pl.y0 + pl.h - pl.Y(v), tone: 'blue', r: 2 })); o.push(line(pl.x0, pl.Y(expct), pl.x0 + pl.w, pl.Y(expct), 'amber', { dash: true, w: 1.4 })); return o })(), txt(370, 70, `χ² = Σ(O−E)²/E = ${fmt(chi, 3)}`, { size: 12.5, mono: true }), txt(370, 94, `critical (5%, 7 dof) = ${crit}`, { size: 12, mono: true, tone: 'dim' }), txt(370, 122, chi < crit ? 'accept: consistent with uniform' : 'REJECT uniformity', { size: 13, bold: true, tone: chi < crit ? 'mint' : 'rose' })], note: 'Count how many numbers fall in each of 8 equal classes and compare with the expected count (amber).' },
    { draw: [heading(20, 14, 'Kolmogorov–Smirnov test'), ...(() => { const pl = makePlot(40, 36, 300, 170, 0, 1, 0, 1); const o: Prim[] = [...pl.axes, line(pl.X(0), pl.Y(0), pl.X(1), pl.Y(1), 'dim', { dash: true })]; const pts: number[][] = [[pl.X(0), pl.Y(0)]]; sorted.forEach((u, i) => { pts.push([pl.X(u), pl.Y(i / sorted.length)], [pl.X(u), pl.Y((i + 1) / sorted.length)]) }); pts.push([pl.X(1), pl.Y(1)]); o.push(poly(pts, 'blue', { w: 1.8 })); return o })(), txt(370, 70, `D = max|F_n(x) − x| = ${fmt(D, 4)}`, { size: 12.5, mono: true }), txt(370, 94, `critical 1.36/√n = ${fmt(dcrit, 4)}`, { size: 12, mono: true, tone: 'dim' }), txt(370, 122, D < dcrit ? 'accept: consistent with uniform' : 'REJECT uniformity', { size: 13, bold: true, tone: D < dcrit ? 'mint' : 'rose' })], note: 'Compare the empirical CDF (blue steps) with the ideal uniform CDF (dashed diagonal): D is the biggest gap.' },
  ]
  return trace(W, H, frames, { sequence: seq.slice(0, 17).join(' '), period: String(period), fullPeriod: fullPeriod ? 'yes' : 'no', chi2: fmt(chi, 3), ks: fmt(D, 4) })
}

// ── Markov chain ────────────────────────────────────────────────────────────

function markovRun(p: Params) {
  const names = pstr(p, 'states', 'Sunny,Rainy').split(/[,\s]+/).filter(Boolean)
  const P = prows(p, 'matrix', [['0.9', '0.1'], ['0.5', '0.5']]).map((r) => r.map(Number))
  const n = names.length
  if (P.length !== n || P.some((r) => r.length !== n || Math.abs(r.reduce((a, b) => a + b, 0) - 1) > 1e-6)) throw new LabError(`matrix must be ${n}×${n} with every row summing to 1`)
  let pi = pnums(p, 'start', [1, ...Array(n - 1).fill(0)])
  if (pi.length !== n) throw new LabError(`start needs ${n} probabilities`)
  const hist = [pi]; const steps = pnum(p, 'steps', 12)
  for (let s = 0; s < steps; s++) { pi = pi.map((_, j) => P.reduce((acc, row, i) => acc + pi[i] * row[j], 0)); hist.push(pi) }
  let st = pi; for (let i = 0; i < 2000; i++) st = st.map((_, j) => P.reduce((acc, row, k) => acc + st[k] * row[j], 0))
  const pos = names.map((_, i) => [90 + i * (300 / Math.max(1, n - 1)) * (n > 1 ? 1 : 0) + (n === 1 ? 150 : 0), 90])
  const frames: Frame[] = hist.map((h, k) => {
    const d: Prim[] = [heading(20, 14, `Markov chain · step ${k}`)]
    names.forEach((nm, i) => { d.push(dot(pos[i][0], pos[i][1], 24, nm, 'blue')) })
    names.forEach((_, i) => names.forEach((__, j) => { if (i !== j && P[i][j] > 0) { const a = pos[i], b = pos[j]; const off = i < j ? -14 : 14; d.push(line(a[0] + 24, a[1] + off / 2, b[0] - 24, b[1] + off / 2, 'dim', { arrow: true, w: 1.2 }), txt((a[0] + b[0]) / 2, a[1] + off * 2.2, fmt(P[i][j], 2), { size: 10.5, mono: true, anchor: 'middle', tone: 'amber' })) } }))
    const pl = makePlot(30, 150, 340, 120, 0, hist.length - 1 || 1, 0, 1, { yticks: 4 })
    d.push(...pl.axes)
    names.forEach((_, i) => d.push(poly(hist.slice(0, k + 1).map((q, t) => [pl.X(t), pl.Y(q[i])]), toneAt(i), { w: 2 })))
    names.forEach((nm, i) => d.push(txt(400, 170 + i * 22, `${nm}: ${fmt(h[i], 4)}`, { size: 12, mono: true, tone: toneAt(i) })))
    d.push(txt(400, 170 + n * 22 + 8, `steady state: ${st.map((v) => fmt(v, 4)).join(', ')}`, { size: 11, mono: true, tone: 'dim' }))
    return { draw: d, note: k === 0 ? 'π₀ is where the chain starts. Each step multiplies the distribution by the transition matrix.' : `π${k} = π${k - 1}·P. The distribution converges to the steady state π = πP, regardless of the start (for an ergodic chain).` }
  })
  const summary: Record<string, string> = {}
  names.forEach((nm, i) => { summary[`steady_${nm}`] = fmt(st[i], 4) })
  return trace(560, 300, frames, summary)
}

export const SIM_ENGINES: EngineDef[] = [
  { id: 'montecarlo', label: 'Monte Carlo (estimating π)', group: G, blurb: 'Random sampling turns an area into a count; the error falls as 1/√n.',
    params: [{ name: 'points', label: 'Points', hint: '10–20000', def: '400' }, { name: 'seed', label: 'Seed', hint: '', def: '11' }], run: mcRun },
  { id: 'mm1', label: 'M/M/1 queue', group: G, blurb: 'A single-server queue as a discrete-event simulation, checked against queueing theory.',
    params: [{ name: 'lambda', label: 'Arrival rate λ', hint: 'customers per time unit', def: '0.8' }, { name: 'mu', label: 'Service rate μ', hint: 'must exceed λ', def: '1' }, { name: 'customers', label: 'Customers', hint: '', def: '300' }, { name: 'seed', label: 'Seed', hint: '', def: '5' }], run: mm1Run },
  { id: 'lcg', label: 'Random-number generator & tests', group: G, blurb: 'Linear congruential generator: period, χ² and Kolmogorov–Smirnov tests.',
    params: [{ name: 'a', label: 'a', hint: 'multiplier', def: '5' }, { name: 'c', label: 'c', hint: 'increment', def: '3' }, { name: 'm', label: 'm', hint: 'modulus', def: '16' }, { name: 'seed', label: 'Seed X₀', hint: '', def: '7' }, { name: 'count', label: 'Numbers to test', hint: '', def: '64' }], run: lcgRun },
  { id: 'markov', label: 'Markov chain', group: G, blurb: 'Evolve a distribution through a transition matrix to its steady state.',
    params: [{ name: 'states', label: 'States', hint: 'names, comma separated', def: 'Sunny,Rainy' }, { name: 'matrix', label: 'Transition matrix', hint: 'rows sum to 1', def: '0.9,0.1;0.5,0.5', long: true }, { name: 'start', label: 'Start distribution', hint: '', def: '1 0' }, { name: 'steps', label: 'Steps', hint: '', def: '12' }], run: markovRun },
]
void box
