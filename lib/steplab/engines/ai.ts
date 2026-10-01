// Artificial intelligence (ENCT 351): search, adversarial search, learning
// (perceptron, k-means, a tiny neural network), genetic algorithms, fuzzy logic.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pnums, pstr, prows } from '../types'
import { box, dot, heading, line, makePlot, niceRange, poly, toneAt, trace, txt, drawBinary, type BNode } from '../draw'
import { rng } from '../expr'

const G = 'Artificial intelligence'

// ── Grid search ─────────────────────────────────────────────────────────────

const MAZE = `S..#....
.#.#.##.
.#...#..
.####.#.
......#G`

export function gridSearch(rows: string[], algo: string) {
  const H = rows.length, W = rows[0].length
  let s: [number, number] | null = null, g: [number, number] | null = null
  rows.forEach((r, y) => r.split('').forEach((c, x) => { if (c === 'S') s = [x, y]; if (c === 'G') g = [x, y] }))
  if (!s || !g) throw new LabError('the grid needs an S (start) and a G (goal); # is a wall')
  const key = (x: number, y: number) => y * W + x
  const h = (x: number, y: number) => Math.abs(x - g![0]) + Math.abs(y - g![1])
  const open: { x: number; y: number; g: number; f: number; order: number }[] = [{ x: s[0], y: s[1], g: 0, f: h(s[0], s[1]), order: 0 }]
  const parent = new Map<number, number>(), best = new Map<number, number>([[key(s[0], s[1]), 0]]), closed = new Set<number>()
  const steps: { cur: [number, number]; open: number[]; closed: number[]; found: boolean; path: number[] }[] = []
  let order = 1, expanded = 0
  while (open.length) {
    let idx = 0
    if (algo === 'bfs') idx = 0
    else if (algo === 'dfs') idx = open.length - 1
    else { const f = (n: (typeof open)[number]) => (algo === 'greedy' ? h(n.x, n.y) : algo === 'astar' ? n.g + h(n.x, n.y) : n.g); idx = open.reduce((b, n, i) => (f(n) < f(open[b]) || (f(n) === f(open[b]) && (h(n.x, n.y) < h(open[b].x, open[b].y) || (h(n.x, n.y) === h(open[b].x, open[b].y) && n.order < open[b].order))) ? i : b), 0) }
    if (!['bfs', 'dfs', 'greedy', 'astar', 'ucs'].includes(algo)) throw new LabError('algo is bfs, dfs, ucs, greedy or astar')
    const cur = open.splice(idx, 1)[0]
    if (closed.has(key(cur.x, cur.y))) continue
    closed.add(key(cur.x, cur.y)); expanded++
    const isGoal = cur.x === g[0] && cur.y === g[1]
    const path: number[] = []
    if (isGoal) { let k = key(cur.x, cur.y); while (true) { path.unshift(k); if (!parent.has(k)) break; k = parent.get(k)! } }
    steps.push({ cur: [cur.x, cur.y], open: open.map((n) => key(n.x, n.y)), closed: [...closed], found: isGoal, path })
    if (isGoal) return { steps, cost: cur.g, expanded, W, H, g, s }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cur.x + dx, ny = cur.y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || rows[ny][nx] === '#' || closed.has(key(nx, ny))) continue
      const ng = cur.g + 1
      if (algo === 'astar' || algo === 'ucs') { if ((best.get(key(nx, ny)) ?? Infinity) <= ng) continue }
      else if (best.has(key(nx, ny))) continue
      best.set(key(nx, ny), ng); parent.set(key(nx, ny), key(cur.x, cur.y))
      open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny), order: order++ })
    }
  }
  return { steps, cost: -1, expanded, W, H, g, s }
}

function searchRun(p: Params) {
  const rows = pstr(p, 'grid', MAZE).split(/[;\n]/).map((r) => r.trim()).filter(Boolean)
  const algo = pstr(p, 'algo', 'astar')
  if (new Set(rows.map((r) => r.length)).size !== 1) throw new LabError('every grid row must have the same width')
  const r = gridSearch(rows, algo)
  const cs = Math.min(40, Math.floor(420 / r.W)), x0 = 20, y0 = 34
  const Wd = 20 + r.W * cs + 220, Hd = 70 + r.H * cs
  const frames: Frame[] = r.steps.map((st, k) => {
    const d: Prim[] = [heading(20, 14, `${algo === 'astar' ? 'A*' : algo.toUpperCase()} search · Manhattan heuristic`)]
    rows.forEach((row, y) => row.split('').forEach((c, x) => {
      const id = y * r.W + x
      const tone: Tone = c === '#' ? 'dim' : c === 'S' ? 'blue' : c === 'G' ? 'rose' : st.path.includes(id) ? 'mint' : st.cur[0] === x && st.cur[1] === y ? 'amber' : st.closed.includes(id) ? 'violet' : st.open.includes(id) ? 'blue' : 'idle'
      // Click a square to build or remove a wall; the search re-runs on the new maze.
      const sq: Prim = { k: 'rect', x: x0 + x * cs, y: y0 + y * cs, w: cs - 2, h: cs - 2, tone, r: 3, solid: c === '#', text: c === 'S' ? 'S' : c === 'G' ? 'G' : undefined }
      d.push(c === 'S' || c === 'G' ? sq : { ...sq, act: { do: 'char', param: 'grid', index: x, row: y, chars: '.#' } })
    }))
    d.push(txt(x0 + r.W * cs + 20, 60, `expanded ${st.closed.length}`, { size: 12.5, mono: true }), txt(x0 + r.W * cs + 20, 84, `frontier ${st.open.length}`, { size: 12.5, mono: true, tone: 'blue' }), txt(x0 + r.W * cs + 20, 130, '■ explored', { size: 11, tone: 'violet' }), txt(x0 + r.W * cs + 20, 148, '■ frontier', { size: 11, tone: 'blue' }), txt(x0 + r.W * cs + 20, 166, '■ current', { size: 11, tone: 'amber' }), txt(x0 + r.W * cs + 20, 184, '■ path', { size: 11, tone: 'mint' }))
    return { draw: d, note: st.found ? `Goal reached after expanding ${st.closed.length} cells; path cost ${r.cost}.` : `Expand (${st.cur[0]}, ${st.cur[1]}) — ${algo === 'bfs' ? 'the oldest frontier cell (FIFO queue)' : algo === 'dfs' ? 'the newest frontier cell (LIFO stack)' : algo === 'greedy' ? 'the cell that looks nearest the goal (min h)' : algo === 'ucs' ? 'the cheapest cell so far (min g)' : 'the cell with the smallest g + h'}.` }
  })
  if (r.cost < 0) throw new LabError('no path: the goal is walled off')
  return trace(Wd, Hd, frames, { cost: String(r.cost), expanded: String(r.expanded) })
}

// ── Minimax with alpha-beta ─────────────────────────────────────────────────

function minimaxRun(p: Params) {
  const b = pnum(p, 'branching', 2), depth = pnum(p, 'depth', 3)
  const vals = pnums(p, 'leaves', [3, 5, 6, 9, 1, 2, 0, -1])
  const prune = pstr(p, 'pruning', 'on') === 'on'
  if (vals.length !== Math.pow(b, depth)) throw new LabError(`branching ${b} and depth ${depth} need ${Math.pow(b, depth)} leaf values, got ${vals.length}`)
  interface N { id: number; level: number; idx: number; v: number | null; a: number; be: number; pruned: boolean; kids: N[]; leaf: boolean }
  let id = 0
  const build = (level: number, idx: number): N => ({ id: id++, level, idx, v: level === depth ? vals[idx] : null, a: -Infinity, be: Infinity, pruned: false, leaf: level === depth, kids: level === depth ? [] : Array.from({ length: b }, (_, k) => build(level + 1, idx * b + k)) })
  const root = build(0, 0)
  const snaps: { vis: Set<number>; done: Map<number, number>; pruned: Set<number>; ab: Map<number, [number, number]>; cur: number; note: string }[] = []
  const vis = new Set<number>(), done = new Map<number, number>(), pr = new Set<number>(), ab = new Map<number, [number, number]>()
  let leavesEval = 0
  const snap = (cur: number, note: string) => snaps.push({ vis: new Set(vis), done: new Map(done), pruned: new Set(pr), ab: new Map(ab), cur, note })
  const markPruned = (n: N) => { pr.add(n.id); n.kids.forEach(markPruned) }
  const go = (n: N, alpha: number, beta: number): number => {
    vis.add(n.id); ab.set(n.id, [alpha, beta])
    if (n.leaf) { leavesEval++; done.set(n.id, n.v!); snap(n.id, `Evaluate leaf → ${n.v}.`); return n.v! }
    const max = n.level % 2 === 0
    let best = max ? -Infinity : Infinity
    for (let i = 0; i < n.kids.length; i++) {
      const v = go(n.kids[i], alpha, beta)
      best = max ? Math.max(best, v) : Math.min(best, v)
      if (max) alpha = Math.max(alpha, best); else beta = Math.min(beta, best)
      ab.set(n.id, [alpha, beta])
      if (prune && alpha >= beta && i < n.kids.length - 1) { n.kids.slice(i + 1).forEach(markPruned); snap(n.id, `α = ${alpha} ≥ β = ${beta}: the ${max ? 'MIN' : 'MAX'} player above would never allow this branch — prune the remaining ${n.kids.length - i - 1} child${n.kids.length - i - 1 > 1 ? 'ren' : ''}.`); break }
    }
    done.set(n.id, best); snap(n.id, `${max ? 'MAX' : 'MIN'} node takes the ${max ? 'largest' : 'smallest'} child value: ${best}.`)
    return best
  }
  snap(-1, `Minimax over a depth-${depth} tree. MAX moves at the root, then MIN, alternating. ${prune ? 'Alpha–beta pruning skips branches that cannot change the answer.' : 'No pruning: every leaf is evaluated.'}`)
  const value = go(root, -Infinity, Infinity)
  const W = 620, H = 60 + depth * 78 + 40
  const totalLeaves = vals.length
  const layoutX = (n: N): number => 40 + ((n.idx * Math.pow(b, depth - n.level) + (Math.pow(b, depth - n.level) - 1) / 2) / totalLeaves) * (W - 80)
  const flat: N[] = []; const collect = (n: N) => { flat.push(n); n.kids.forEach(collect) }; collect(root)
  const frames: Frame[] = snaps.map((s) => {
    const d: Prim[] = [heading(20, 14, `Minimax${prune ? ' + alpha-beta' : ''}`)]
    for (const n of flat) for (const k of n.kids) d.push(line(layoutX(n), 50 + n.level * 78, layoutX(k), 50 + k.level * 78, s.pruned.has(k.id) ? 'rose' : 'dim', { dash: s.pruned.has(k.id), w: 1.3 }))
    for (const n of flat) {
      const x = layoutX(n), y = 50 + n.level * 78, val = s.done.get(n.id)
      const tone: Tone = s.pruned.has(n.id) ? 'dim' : n.id === s.cur ? 'amber' : val !== undefined ? 'mint' : s.vis.has(n.id) ? 'blue' : 'idle'
      if (n.leaf) d.push(box(x - 16, y - 13, 32, 26, String(n.v), tone)); else if (n.level % 2 === 0) d.push(poly([[x, y - 17], [x + 17, y + 13], [x - 17, y + 13]], tone, { closed: true, fill: true, w: 1.6 }), txt(x, y + 6, val === undefined ? '' : String(val), { size: 11, mono: true, anchor: 'middle' })); else d.push(poly([[x, y + 17], [x + 17, y - 13], [x - 17, y - 13]], tone, { closed: true, fill: true, w: 1.6 }), txt(x, y - 4, val === undefined ? '' : String(val), { size: 11, mono: true, anchor: 'middle' }))
      const a = s.ab.get(n.id); if (a && !n.leaf && s.vis.has(n.id) && prune) d.push(txt(x, y + 30, `α${a[0] === -Infinity ? '−∞' : a[0]} β${a[1] === Infinity ? '∞' : a[1]}`, { size: 9, mono: true, anchor: 'middle', tone: 'dim' }))
    }
    return { draw: d, note: s.note }
  })
  const evaluated = leavesEval
  return trace(W, H, frames, { value: String(value), leavesEvaluated: String(evaluated), leavesTotal: String(totalLeaves) })
}

// ── Perceptron ──────────────────────────────────────────────────────────────

function perceptronRun(p: Params) {
  const data = prows(p, 'data', [['0', '0', '0'], ['0', '1', '0'], ['1', '0', '0'], ['1', '1', '1']]).map((r) => r.map(Number))
  if (data.some((r) => r.length !== 3 || r.some((v) => !Number.isFinite(v)))) throw new LabError('data rows are x1,x2,label (label 0 or 1)')
  const lr = pnum(p, 'lr', 0.5), epochs = pnum(p, 'epochs', 12)
  let w = [0, 0], b = 0
  const snaps: { w: number[]; b: number; errors: number; note: string; hit?: number }[] = [{ w: [...w], b, errors: -1, note: 'Start with weights 0. The perceptron predicts 1 when w·x + b > 0.' }]
  let converged = -1
  for (let e = 1; e <= epochs; e++) {
    let errors = 0
    data.forEach((row, i) => {
      const pred = w[0] * row[0] + w[1] * row[1] + b > 0 ? 1 : 0, err = row[2] - pred
      if (err !== 0) { errors++; w = [w[0] + lr * err * row[0], w[1] + lr * err * row[1]]; b += lr * err; snaps.push({ w: [...w], b, errors, hit: i, note: `Epoch ${e}, point (${row[0]}, ${row[1]}) has label ${row[2]} but was classified ${pred}: nudge w ← w + η(t − y)x → (${fmt(w[0], 2)}, ${fmt(w[1], 2)}), b = ${fmt(b, 2)}.` }) }
    })
    if (errors === 0) { converged = e; snaps.push({ w: [...w], b, errors: 0, note: `Epoch ${e}: every point is classified correctly — the perceptron has converged.` }); break }
  }
  const xs = data.map((r) => r[0]), ys = data.map((r) => r[1])
  const [lo, hi] = niceRange([...xs, ...ys])
  const pl = makePlot(40, 30, 260, 260, lo, hi, lo, hi)
  const frames: Frame[] = snaps.map((s) => {
    // Click to add a point of class 1 (Shift: class 0); drag to move; double-click to remove.
    const d: Prim[] = [heading(20, 14, 'Perceptron learning'), ...pl.axes, pl.addPoints('data', ['1', '0'])]
    if (Math.abs(s.w[1]) > 1e-9) d.push(line(pl.X(lo), pl.Y((-s.b - s.w[0] * lo) / s.w[1]), pl.X(hi), pl.Y((-s.b - s.w[0] * hi) / s.w[1]), 'amber', { w: 2 }))
    else if (Math.abs(s.w[0]) > 1e-9) d.push(line(pl.X(-s.b / s.w[0]), pl.Y(lo), pl.X(-s.b / s.w[0]), pl.Y(hi), 'amber', { w: 2 }))
    data.forEach((r, i) => d.push(pl.movable(dot(pl.X(r[0]), pl.Y(r[1]), s.hit === i ? 8 : 6, r[2] ? '1' : '0', r[2] ? 'mint' : 'rose', {}), 'data', i)))
    d.push(txt(330, 60, `w = (${fmt(s.w[0], 2)}, ${fmt(s.w[1], 2)})`, { size: 12.5, mono: true }), txt(330, 84, `b = ${fmt(s.b, 2)}`, { size: 12.5, mono: true }), txt(330, 112, s.errors >= 0 ? `misclassified this pass: ${s.errors}` : '', { size: 11.5, mono: true, tone: 'rose' }))
    return { draw: d, note: s.note }
  })
  return trace(560, 320, frames, { converged: converged > 0 ? 'yes' : 'no', epochs: String(converged), w1: fmt(w[0], 3), w2: fmt(w[1], 3), b: fmt(b, 3) })
}

// ── k-means ─────────────────────────────────────────────────────────────────

function kmeansRun(p: Params) {
  const pts = prows(p, 'points', [['1', '1'], ['1.5', '2'], ['3', '4'], ['5', '7'], ['3.5', '5'], ['4.5', '5'], ['3.5', '4.5']]).map((r) => r.map(Number))
  const k = pnum(p, 'k', 2)
  if (pts.length < k || pts.some((r) => r.length !== 2 || r.some((v) => !Number.isFinite(v)))) throw new LabError('points are x,y pairs and there must be at least k of them')
  let cent = pts.slice(0, k).map((q) => [...q])
  const hist: { assign: number[]; cent: number[][]; sse: number; note: string }[] = []
  let prev: number[] = []
  for (let it = 1; it <= 20; it++) {
    const assign = pts.map((q) => cent.reduce((b, c, i) => (Math.hypot(q[0] - c[0], q[1] - c[1]) < Math.hypot(q[0] - cent[b][0], q[1] - cent[b][1]) ? i : b), 0))
    const sse = pts.reduce((s, q, i) => s + (q[0] - cent[assign[i]][0]) ** 2 + (q[1] - cent[assign[i]][1]) ** 2, 0)
    hist.push({ assign, cent: cent.map((c) => [...c]), sse, note: `Iteration ${it} — assign: every point joins its nearest centroid. SSE = ${fmt(sse, 3)}.` })
    if (prev.length && assign.every((a, i) => a === prev[i])) { hist[hist.length - 1].note = `Iteration ${it}: no point changed cluster — converged. SSE = ${fmt(sse, 3)}.`; break }
    prev = assign
    cent = cent.map((c, i) => { const m = pts.filter((_, j) => assign[j] === i); return m.length ? [m.reduce((s, q) => s + q[0], 0) / m.length, m.reduce((s, q) => s + q[1], 0) / m.length] : c })
    hist.push({ assign, cent: cent.map((c) => [...c]), sse, note: `Iteration ${it} — update: move each centroid to the mean of its points.` })
  }
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
  const [kx0, kx1] = niceRange(xs), [ky0, ky1] = niceRange(ys)
  const pl = makePlot(40, 30, 300, 260, kx0, kx1, ky0, ky1)
  const frames: Frame[] = hist.map((h) => ({ draw: [heading(20, 14, `k-means · k = ${k}`), ...pl.axes, pl.addPoints('points'), ...pts.map((q, i) => pl.movable(dot(pl.X(q[0]), pl.Y(q[1]), 5, undefined, toneAt(h.assign[i]), { solid: true }), 'points', i)), ...h.cent.map((c, i) => box(pl.X(c[0]) - 7, pl.Y(c[1]) - 7, 14, 14, '', toneAt(i))), txt(370, 60, `SSE ${fmt(h.sse, 3)}`, { size: 12.5, mono: true, tone: 'amber' })], note: h.note }))
  const last = hist[hist.length - 1]
  return trace(560, 320, frames, { sse: fmt(last.sse, 3), centroids: last.cent.map((c) => `(${fmt(c[0], 2)},${fmt(c[1], 2)})`).join(' '), iterations: String(Math.ceil(hist.length / 2)) })
}

// ── Genetic algorithm ───────────────────────────────────────────────────────

function gaRun(p: Params) {
  const bitsN = pnum(p, 'bits', 5), popN = pnum(p, 'population', 6), gens = pnum(p, 'generations', 8), pm = pnum(p, 'mutation', 0.02), pc = pnum(p, 'crossover', 0.8)
  const r = rng(pnum(p, 'seed', 4))
  const fit = (c: number[]) => { const v = parseInt(c.join(''), 2); return v * v }
  let pop: number[][] = Array.from({ length: popN }, () => Array.from({ length: bitsN }, () => (r() < 0.5 ? 0 : 1)))
  const hist: { pop: number[][]; note: string }[] = [{ pop: pop.map((c) => [...c]), note: `Maximise f(x) = x² for x in 0…${(1 << bitsN) - 1}. Each individual is a ${bitsN}-bit string; fitness is f(x).` }]
  const best: number[] = [Math.max(...pop.map(fit))]
  for (let g = 1; g <= gens; g++) {
    const total = pop.reduce((s, c) => s + fit(c) + 1, 0)
    const pick = () => { let t = r() * total; for (const c of pop) { t -= fit(c) + 1; if (t <= 0) return c } return pop[pop.length - 1] }
    const next: number[][] = []
    while (next.length < popN) {
      const a = pick(), b = pick()
      let c1 = [...a], c2 = [...b]
      if (r() < pc) { const cut = 1 + Math.floor(r() * (bitsN - 1)); c1 = [...a.slice(0, cut), ...b.slice(cut)]; c2 = [...b.slice(0, cut), ...a.slice(cut)] }
      for (const c of [c1, c2]) { for (let i = 0; i < bitsN; i++) if (r() < pm) c[i] ^= 1; if (next.length < popN) next.push(c) }
    }
    pop = next
    best.push(Math.max(...pop.map(fit)))
    hist.push({ pop: pop.map((c) => [...c]), note: `Generation ${g}: selection favours fit parents (roulette wheel), crossover swaps tails at a random cut, mutation flips a rare bit. Best fitness ${best[best.length - 1]}.` })
  }
  const W = 620, H = 60 + popN * 30 + 130
  const frames: Frame[] = hist.map((h, k) => {
    const d: Prim[] = [heading(20, 14, `Genetic algorithm · generation ${k}`)]
    h.pop.forEach((c, i) => { d.push(...c.map((b, j) => box(20 + j * 26, 34 + i * 30, 24, 24, String(b), b ? 'mint' : 'idle'))); d.push(txt(20 + bitsN * 26 + 12, 51 + i * 30, `x = ${String(parseInt(c.join(''), 2)).padStart(2)}   f = ${fit(c)}`, { size: 12, mono: true })) })
    const pl = makePlot(20, 34 + popN * 30 + 20, 300, 80, 0, Math.max(1, gens), 0, ((1 << bitsN) - 1) ** 2 * 1.1, { yticks: 3 })
    d.push(...pl.axes, poly(best.slice(0, k + 1).map((v, i) => [pl.X(i), pl.Y(v)]), 'amber', { w: 2 }), txt(340, 34 + popN * 30 + 50, `best so far ${Math.max(...best.slice(0, k + 1))}`, { size: 12, mono: true, tone: 'amber' }))
    return { draw: d, note: h.note }
  })
  return trace(W, H, frames, { best: String(Math.max(...best)), optimum: String(((1 << bitsN) - 1) ** 2) })
}

// ── Tiny neural network (XOR) ───────────────────────────────────────────────

function mlpRun(p: Params) {
  const lr = pnum(p, 'lr', 1), epochs = pnum(p, 'epochs', 4000), hidden = pnum(p, 'units', 3), r = rng(pnum(p, 'seed', 2))
  const X = [[0, 0], [0, 1], [1, 0], [1, 1]], T = [0, 1, 1, 0]
  const sig = (z: number) => 1 / (1 + Math.exp(-z))
  const W1 = Array.from({ length: hidden }, () => [r() * 2 - 1, r() * 2 - 1]), b1 = Array(hidden).fill(0).map(() => r() * 2 - 1), W2 = Array.from({ length: hidden }, () => r() * 2 - 1); let b2 = r() * 2 - 1
  const fwd = (x: number[]) => { const h = W1.map((w, j) => sig(w[0] * x[0] + w[1] * x[1] + b1[j])); return { h, y: sig(h.reduce((s, v, j) => s + v * W2[j], b2)) } }
  const loss = () => X.reduce((s, x, i) => s + (fwd(x).y - T[i]) ** 2, 0) / 4
  const hist: { epoch: number; loss: number; out: number[]; w: number[][] }[] = []
  const snapAt = new Set([0, 100, 500, 1000, 2000, epochs])
  for (let e = 0; e <= epochs; e++) {
    if (snapAt.has(e)) hist.push({ epoch: e, loss: loss(), out: X.map((x) => fwd(x).y), w: [...W1.map((w) => [...w]), [...W2]] })
    if (e === epochs) break
    X.forEach((x, i) => { const { h, y } = fwd(x); const dy = (y - T[i]) * y * (1 - y); W2.forEach((_, j) => { const dh = dy * W2[j] * h[j] * (1 - h[j]); W2[j] -= lr * dy * h[j]; W1[j][0] -= lr * dh * x[0]; W1[j][1] -= lr * dh * x[1]; b1[j] -= lr * dh }); b2 -= lr * dy })
  }
  const W = 640, H = 320
  const frames: Frame[] = hist.map((h) => {
    const d: Prim[] = [heading(20, 14, `Neural network 2-${hidden}-1 learning XOR by backpropagation · epoch ${h.epoch}`)]
    const inY = [110, 190], hidY = Array.from({ length: hidden }, (_, j) => 50 + (j * 220) / Math.max(1, hidden - 1) + (hidden === 1 ? 80 : 0)), outY = 150
    inY.forEach((y, i) => d.push(dot(60, y, 15, `x${i + 1}`, 'blue')))
    hidY.forEach((y, j) => { d.push(dot(200, y, 15, `h${j + 1}`, 'violet')); inY.forEach((iy, i) => d.push(line(75, iy, 185, y, h.w[j][i] >= 0 ? 'mint' : 'rose', { w: Math.min(4, 0.6 + Math.abs(h.w[j][i]) * 0.5) })), line(215, y, 335, outY, h.w[hidden][j] >= 0 ? 'mint' : 'rose', { w: Math.min(4, 0.6 + Math.abs(h.w[hidden][j]) * 0.5) })) })
    d.push(dot(350, outY, 15, 'y', 'amber'))
    d.push(txt(60, 250, 'line thickness = |weight|, green + / red −', { size: 10, tone: 'dim' }))
    const pl = makePlot(400, 50, 210, 90, 0, epochs, 0, 0.3, { yticks: 3 })
    d.push(...pl.axes, poly(hist.filter((q) => q.epoch <= h.epoch).map((q) => [pl.X(q.epoch), pl.Y(Math.min(0.3, q.loss))]), 'rose', { w: 2 }), txt(400, 40, `loss ${h.loss.toFixed(4)}`, { size: 11.5, mono: true, tone: 'rose' }))
    X.forEach((x, i) => d.push(txt(400, 190 + i * 20, `(${x[0]}, ${x[1]}) → ${h.out[i].toFixed(3)}   target ${T[i]}`, { size: 11.5, mono: true, tone: Math.round(h.out[i]) === T[i] ? 'mint' : 'rose' })))
    return { draw: d, note: h.epoch === 0 ? 'Random weights: the outputs are near 0.5 — the network knows nothing. XOR is not linearly separable, so one neuron cannot solve it; a hidden layer can.' : `After ${h.epoch} epochs the loss is ${h.loss.toFixed(4)}. Backpropagation nudges every weight downhill along the gradient of the error.` }
  })
  const last = hist[hist.length - 1]
  return trace(W, H, frames, { loss: last.loss.toFixed(4), outputs: last.out.map((v) => v.toFixed(2)).join(' '), solved: last.out.every((v, i) => Math.round(v) === T[i]) ? 'yes' : 'no' })
}

// ── Fuzzy logic ─────────────────────────────────────────────────────────────

function fuzzyRun(p: Params) {
  const t = pnum(p, 'temp', 28)
  const tri = (x: number, a: number, b: number, c: number) => Math.max(0, Math.min((x - a) / (b - a || 1), (c - x) / (c - b || 1)))
  const cold = (x: number) => (x <= 10 ? 1 : x >= 25 ? 0 : (25 - x) / 15), warm = (x: number) => tri(x, 15, 25, 35), hot = (x: number) => (x <= 25 ? 0 : x >= 40 ? 1 : (x - 25) / 15)
  const mu = { cold: cold(t), warm: warm(t), hot: hot(t) }
  // rules: cold → fan low(20), warm → medium(50), hot → high(90) ; Sugeno-style weighted average and Mamdani centroid
  const outs = { low: (y: number) => (y <= 20 ? 1 : y >= 50 ? 0 : (50 - y) / 30), med: (y: number) => tri(y, 30, 50, 70), high: (y: number) => (y <= 50 ? 0 : y >= 80 ? 1 : (y - 50) / 30) }
  const agg = (y: number) => Math.max(Math.min(mu.cold, outs.low(y)), Math.min(mu.warm, outs.med(y)), Math.min(mu.hot, outs.high(y)))
  let num = 0, den = 0; for (let y = 0; y <= 100; y += 0.5) { num += y * agg(y); den += agg(y) }
  const speed = den ? num / den : 0
  const p1 = makePlot(30, 34, 250, 110, 0, 50, 0, 1.05, { yticks: 2 }), p2 = makePlot(330, 34, 250, 110, 0, 100, 0, 1.05, { yticks: 2 })
  const p3 = makePlot(330, 190, 250, 100, 0, 100, 0, 1.05, { yticks: 2 })
  const frames: Frame[] = [
    { draw: [heading(20, 14, 'Fuzzy sets for temperature'), ...p1.axes, p1.curve(cold, 'blue'), p1.curve(warm, 'amber'), p1.curve(hot, 'rose'), line(p1.X(t), p1.y0, p1.X(t), p1.y0 + p1.h, 'dim', { dash: true })], note: `Temperature ${t}° is not simply "hot" or "cold": it belongs to each fuzzy set to a degree between 0 and 1.` },
    { draw: [heading(20, 14, `Fuzzification of ${t}°`), ...p1.axes, p1.curve(cold, 'blue'), p1.curve(warm, 'amber'), p1.curve(hot, 'rose'), line(p1.X(t), p1.y0, p1.X(t), p1.y0 + p1.h, 'dim', { dash: true }), txt(30, 190, `μ_cold = ${fmt(mu.cold, 3)}   μ_warm = ${fmt(mu.warm, 3)}   μ_hot = ${fmt(mu.hot, 3)}`, { size: 12.5, mono: true })], note: 'Read the vertical line off each membership function.' },
    { draw: [heading(20, 14, 'Rules clip the output sets'), txt(30, 40, 'IF cold THEN fan low', { size: 12, mono: true, tone: 'blue' }), txt(30, 60, 'IF warm THEN fan medium', { size: 12, mono: true, tone: 'amber' }), txt(30, 80, 'IF hot  THEN fan high', { size: 12, mono: true, tone: 'rose' }), ...p2.axes, p2.curve((y) => Math.min(mu.cold, outs.low(y)), 'blue'), p2.curve((y) => Math.min(mu.warm, outs.med(y)), 'amber'), p2.curve((y) => Math.min(mu.hot, outs.high(y)), 'rose')], note: 'Each rule fires with the strength of its condition (min) and clips its output set at that height.' },
    { draw: [heading(20, 14, 'Defuzzification by centroid'), ...p3.axes, p3.curve(agg, 'mint', 2.4), line(p3.X(speed), p3.y0, p3.X(speed), p3.y0 + p3.h, 'violet', { w: 2 }), txt(30, 60, `fan speed = ${fmt(speed, 1)} %`, { size: 16, mono: true, bold: true, tone: 'violet' }), txt(30, 84, 'centroid of the union of clipped sets', { size: 11, tone: 'dim' })], note: 'The clipped sets are combined (max) and the crisp output is their centre of mass.' },
  ]
  return trace(600, 310, frames, { muCold: fmt(mu.cold, 3), muWarm: fmt(mu.warm, 3), muHot: fmt(mu.hot, 3), speed: fmt(speed, 1) })
}

export const AI_ENGINES: EngineDef[] = [
  { id: 'search', label: 'Search algorithms', group: G, blurb: 'BFS, DFS, uniform-cost, greedy best-first and A* on a grid maze.',
    params: [{ name: 'algo', label: 'Algorithm', hint: 'bfs dfs ucs greedy astar', def: 'astar', options: ['bfs', 'dfs', 'ucs', 'greedy', 'astar'] }, { name: 'grid', label: 'Maze', hint: 'S start, G goal, # wall; rows on separate lines', def: MAZE, long: true }], run: searchRun },
  { id: 'minimax', label: 'Minimax & alpha-beta', group: G, blurb: 'Adversarial search: MAX vs MIN, and the branches alpha-beta never has to look at.',
    params: [{ name: 'branching', label: 'Branching', hint: 'children per node', def: '2' }, { name: 'depth', label: 'Depth', hint: 'levels below the root', def: '3' }, { name: 'leaves', label: 'Leaf values', hint: 'left to right', def: '3 5 6 9 1 2 0 -1' }, { name: 'pruning', label: 'Pruning', hint: 'on | off', def: 'on', options: ['on', 'off'] }], run: minimaxRun },
  { id: 'perceptron', label: 'Perceptron', group: G, blurb: 'A single neuron learning a linear boundary.',
    params: [{ name: 'data', label: 'Data', hint: 'x1,x2,label ; …', def: '0,0,0;0,1,0;1,0,0;1,1,1', long: true }, { name: 'lr', label: 'Learning rate', hint: '', def: '0.5' }, { name: 'epochs', label: 'Max epochs', hint: '', def: '12' }], run: perceptronRun },
  { id: 'kmeans', label: 'k-means clustering', group: G, blurb: 'Assign points to the nearest centroid, move the centroids, repeat.',
    params: [{ name: 'points', label: 'Points', hint: 'x,y ; …', def: '1,1;1.5,2;3,4;5,7;3.5,5;4.5,5;3.5,4.5', long: true }, { name: 'k', label: 'k', hint: 'clusters', def: '2' }], run: kmeansRun },
  { id: 'ga', label: 'Genetic algorithm', group: G, blurb: 'Selection, crossover and mutation evolving a population toward the optimum.',
    params: [{ name: 'bits', label: 'Bits', hint: '', def: '5' }, { name: 'population', label: 'Population', hint: '', def: '6' }, { name: 'generations', label: 'Generations', hint: '', def: '8' }, { name: 'mutation', label: 'Mutation rate', hint: '', def: '0.02' }, { name: 'crossover', label: 'Crossover rate', hint: '', def: '0.8' }, { name: 'seed', label: 'Seed', hint: '', def: '4' }], run: gaRun },
  { id: 'mlp', label: 'Neural network (XOR)', group: G, blurb: 'A hidden layer and backpropagation solve what a single neuron cannot.',
    params: [{ name: 'units', label: 'Hidden units', hint: '', def: '3' }, { name: 'lr', label: 'Learning rate', hint: '', def: '1' }, { name: 'epochs', label: 'Epochs', hint: '', def: '4000' }, { name: 'seed', label: 'Seed', hint: '', def: '2' }], run: mlpRun },
  { id: 'fuzzy', label: 'Fuzzy inference', group: G, blurb: 'Fuzzify a temperature, fire rules, defuzzify to a fan speed.',
    params: [{ name: 'temp', label: 'Temperature', hint: '0–50', def: '28' }], run: fuzzyRun },
]
void drawBinary
