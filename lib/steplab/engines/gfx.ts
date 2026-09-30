// Computer graphics (ENCT 201): rasterisation, clipping, 2-D transformations,
// Bézier curves, the 3-D viewing pipeline and Phong illumination.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pnums, pstr, prows } from '../types'
import { box, dot, heading, line, makePlot, poly, toneAt, trace, txt } from '../draw'

const G = 'Computer graphics'

// ── Rasterisation ───────────────────────────────────────────────────────────

export function bresenham(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; e: number }[] {
  const out: { x: number; y: number; e: number }[] = []
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push({ x: x0, y: y0, e: err })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
  return out
}
export function midCircle(r: number): [number, number][] {
  const pts: [number, number][] = []
  let x = 0, y = r, p = 1 - r
  while (x <= y) { pts.push([x, y]); x++; if (p < 0) p += 2 * x + 1; else { y--; p += 2 * (x - y) + 1 } }
  return pts
}

const gridPrims = (n: number, cs: number, ox: number, oy: number): Prim[] => {
  const d: Prim[] = []
  for (let i = 0; i <= n; i++) { d.push(line(ox + i * cs, oy, ox + i * cs, oy + n * cs, 'dim', { w: 0.35 }), line(ox, oy + i * cs, ox + n * cs, oy + i * cs, 'dim', { w: 0.35 })) }
  for (let i = 0; i < n; i += 2) { d.push(txt(ox + i * cs + cs / 2, oy + n * cs + 12, String(i), { size: 9, anchor: 'middle', mono: true, tone: 'dim' }), txt(ox - 6, oy + (n - 1 - i) * cs + cs / 2 + 3, String(i), { size: 9, anchor: 'end', mono: true, tone: 'dim' })) }
  return d
}

function rasterRun(p: Params) {
  const algo = pstr(p, 'algo', 'bresenham'), N = pnum(p, 'grid', 16)
  const cs = Math.floor(320 / N), ox = 30, oy = 30
  const px = (x: number, y: number, tone: Tone): Prim => ({ k: 'rect', x: ox + x * cs + 1, y: oy + (N - 1 - y) * cs + 1, w: cs - 2, h: cs - 2, tone, solid: tone === 'mint', r: 2 })
  const frames: Frame[] = []
  const W = ox + N * cs + 250, H = oy + N * cs + 40
  const base = (): Prim[] => [heading(20, 14, algo.toUpperCase()), ...gridPrims(N, cs, ox, oy)]
  const side = (lines: string[]): Prim[] => lines.map((t, i) => txt(ox + N * cs + 24, 50 + i * 20, t, { size: 11.5, mono: true, tone: i === 0 ? 'amber' : 'idle' }))
  const summary: Record<string, string> = {}
  if (algo === 'dda' || algo === 'bresenham') {
    const [x0, y0, x1, y1] = [pnum(p, 'x1', 2), pnum(p, 'y1', 2), pnum(p, 'x2', 13), pnum(p, 'y2', 8)]
    if ([x0, y0, x1, y1].some((v) => v < 0 || v >= N || !Number.isInteger(v))) throw new LabError(`endpoints must be integers in 0…${N - 1}`)
    if (algo === 'dda') {
      const dx = x1 - x0, dy = y1 - y0, steps = Math.max(Math.abs(dx), Math.abs(dy)), xi = dx / (steps || 1), yi = dy / (steps || 1)
      const pts: [number, number][] = []
      let x = x0, y = y0
      frames.push({ draw: [...base(), ...side([`Δx=${dx}  Δy=${dy}`, `steps = max(|Δx|,|Δy|) = ${steps}`, `x-inc = ${fmt(xi, 3)}`, `y-inc = ${fmt(yi, 3)}`])], note: 'DDA: step by 1 along the longer axis; the other coordinate advances by the slope; round each point to a pixel.' })
      for (let i = 0; i <= steps; i++) {
        const rx = Math.round(x), ry = Math.round(y); pts.push([rx, ry])
        frames.push({ draw: [...base(), ...pts.map(([a, b], j) => px(a, b, j === pts.length - 1 ? 'blue' : 'mint')), ...side([`step ${i}`, `x = ${fmt(x, 3)}  → ${rx}`, `y = ${fmt(y, 3)}  → ${ry}`])], note: `Step ${i}: (${fmt(x, 2)}, ${fmt(y, 2)}) rounds to pixel (${rx}, ${ry}).` })
        x += xi; y += yi
      }
      summary.pixels = pts.map((q) => q.join(',')).join(' ')
    } else {
      const pts = bresenham(x0, y0, x1, y1)
      frames.push({ draw: [...base(), ...side([`Δx=${Math.abs(x1 - x0)}  Δy=${Math.abs(y1 - y0)}`, 'integer error term only:', 'no multiplication, no rounding'])], note: "Bresenham keeps an integer error term that says how far the ideal line is from the pixel centre, and steps in y only when the error demands it." })
      pts.forEach((q, i) => frames.push({ draw: [...base(), ...pts.slice(0, i + 1).map((r, j) => px(r.x, r.y, j === i ? 'blue' : 'mint')), ...side([`pixel ${i + 1}`, `(${q.x}, ${q.y})`, `error = ${q.e}`])], note: `Plot (${q.x}, ${q.y}); the error term is ${q.e}.` }))
      summary.pixels = pts.map((q) => `${q.x},${q.y}`).join(' ')
    }
  } else if (algo === 'circle') {
    const r = pnum(p, 'r', 6), cx = pnum(p, 'cx', 8), cy = pnum(p, 'cy', 8)
    if (cx + r >= N || cy + r >= N || cx - r < 0 || cy - r < 0) throw new LabError('the circle does not fit inside the grid')
    const oct = midCircle(r)
    const sym = (x: number, y: number): [number, number][] => [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]
    frames.push({ draw: [...base(), ...side([`radius ${r}`, 'decision p₀ = 1 − r = ' + (1 - r), 'p < 0 → keep y', 'p ≥ 0 → y − 1'])], note: 'Mid-point circle: compute only one octant (x from 0 to y) and reflect it eight ways.' })
    const all: [number, number][] = []
    let p2 = 1 - r
    oct.forEach(([x, y], i) => {
      sym(x, y).forEach(([a, b]) => all.push([cx + a, cy + b]))
      frames.push({ draw: [...base(), ...all.map(([a, b]) => px(a, b, 'mint')), ...sym(x, y).map(([a, b]) => px(cx + a, cy + b, 'blue')), ...side([`point ${i + 1}`, `(x, y) = (${x}, ${y})`, `p = ${p2}`])], note: `Octant point (${x}, ${y}) plotted in all 8 octants. ${p2 < 0 ? 'p < 0: the mid-point is inside, keep y' : 'p ≥ 0: the mid-point is outside, decrement y'}.` })
      x++; if (p2 < 0) p2 += 2 * x + 1; else { p2 += 2 * (x - (y - 1)) + 1 }
    })
    summary.octant = oct.map((q) => q.join(',')).join(' ')
  } else if (algo === 'floodfill') {
    const verts = prows(p, 'polygon', [['3', '3'], ['12', '3'], ['12', '10'], ['7', '13'], ['3', '10']]).map((r) => r.map(Number))
    const seed = [pnum(p, 'sx', 7), pnum(p, 'sy', 7)], conn = pnum(p, 'connect', 4)
    const wall = new Set<string>()
    verts.forEach((v, i) => { const w = verts[(i + 1) % verts.length]; bresenham(v[0], v[1], w[0], w[1]).forEach((q) => wall.add(`${q.x},${q.y}`)) })
    const filled = new Set<string>(), stack: number[][] = [seed], order: number[][] = []
    const dirs = conn === 8 ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]]
    frames.push({ draw: [...base(), ...[...wall].map((k) => { const [a, b] = k.split(',').map(Number); return px(a, b, 'rose') }), px(seed[0], seed[1], 'blue'), ...side(['boundary (red)', `seed (${seed[0]}, ${seed[1]})`, `${conn}-connected`])], note: `Flood fill from the seed: spread to every ${conn}-connected neighbour that is neither boundary nor already filled.` })
    while (stack.length && order.length < 600) {
      const [x, y] = stack.pop()!
      if (x < 0 || y < 0 || x >= N || y >= N || wall.has(`${x},${y}`) || filled.has(`${x},${y}`)) continue
      filled.add(`${x},${y}`); order.push([x, y])
      for (const [dx, dy] of dirs) stack.push([x + dx, y + dy])
    }
    if (order.length >= 600) throw new LabError('the region leaks — the boundary is not closed, so the fill escapes')
    const every = Math.max(1, Math.floor(order.length / 30))
    for (let i = 0; i < order.length; i += every) frames.push({ draw: [...base(), ...[...wall].map((k) => { const [a, b] = k.split(',').map(Number); return px(a, b, 'rose') }), ...order.slice(0, i + 1).map(([a, b]) => px(a, b, 'mint')), ...side([`filled ${Math.min(order.length, i + every)}`, `stack depth ${stack.length}`])], note: `${Math.min(order.length, i + every)} pixels filled so far.` })
    frames.push({ draw: [...base(), ...[...wall].map((k) => { const [a, b] = k.split(',').map(Number); return px(a, b, 'rose') }), ...order.map(([a, b]) => px(a, b, 'mint')), ...side([`filled ${order.length}`, 'done'])], note: `Filled ${order.length} pixels. With 4-connectivity a diagonal gap in the boundary would stop the fill; 8-connectivity can leak through such a gap.` })
    summary.filled = String(order.length)
  } else throw new LabError('algo is dda, bresenham, circle or floodfill')
  return trace(W, H, frames, summary)
}

// ── Clipping ────────────────────────────────────────────────────────────────

function outcode(x: number, y: number, w: number[]): number { return (x < w[0] ? 1 : 0) | (x > w[2] ? 2 : 0) | (y < w[1] ? 4 : 0) | (y > w[3] ? 8 : 0) }
const codeStr = (c: number) => [8, 4, 2, 1].map((b) => (c & b ? 1 : 0)).join('') // TBRL

function clipRun(p: Params) {
  const win = pnums(p, 'window', [20, 20, 80, 70]), ln = pnums(p, 'line', [5, 10, 95, 80]), algo = pstr(p, 'algo', 'cohen')
  if (win.length !== 4 || ln.length !== 4) throw new LabError('window is xmin ymin xmax ymax; line is x1 y1 x2 y2')
  let [x1, y1, x2, y2] = ln
  const pl = makePlot(30, 30, 380, 280, 0, 100, 0, 100, { xticks: 5, yticks: 5 })
  const draw = (l: number[], extra: Prim[] = []): Prim[] => [heading(20, 14, algo === 'cohen' ? 'Cohen–Sutherland' : 'Liang–Barsky'), ...pl.axes, { k: 'rect', x: pl.X(win[0]), y: pl.Y(win[3]), w: pl.X(win[2]) - pl.X(win[0]), h: pl.Y(win[1]) - pl.Y(win[3]), tone: 'amber', r: 0 }, line(pl.X(ln[0]), pl.Y(ln[1]), pl.X(ln[2]), pl.Y(ln[3]), 'dim', { dash: true }), line(pl.X(l[0]), pl.Y(l[1]), pl.X(l[2]), pl.Y(l[3]), 'blue', { w: 2.4 }), ...extra]
  const frames: Frame[] = []
  const summary: Record<string, string> = {}
  if (algo === 'cohen') {
    frames.push({ draw: draw(ln), note: 'Give each endpoint a 4-bit outcode (Top Bottom Right Left) saying which side of the window it lies beyond.' })
    for (let it = 0; it < 8; it++) {
      const c1 = outcode(x1, y1, win), c2 = outcode(x2, y2, win)
      const info = [txt(430, 60, `P1 (${fmt(x1, 2)}, ${fmt(y1, 2)})  ${codeStr(c1)}`, { size: 11, mono: true }), txt(430, 82, `P2 (${fmt(x2, 2)}, ${fmt(y2, 2)})  ${codeStr(c2)}`, { size: 11, mono: true }), txt(430, 104, `AND = ${codeStr(c1 & c2)}`, { size: 11, mono: true, tone: 'dim' })]
      if ((c1 | c2) === 0) { frames.push({ draw: draw([x1, y1, x2, y2], info), note: 'Both outcodes are 0000: trivially ACCEPT — the segment is inside.' }); summary.result = `${fmt(x1, 2)},${fmt(y1, 2)} ${fmt(x2, 2)},${fmt(y2, 2)}`; break }
      if (c1 & c2) { frames.push({ draw: draw([x1, y1, x1, y1], info), note: `The outcodes share a 1 bit (AND = ${codeStr(c1 & c2)}): both ends are beyond the same edge — trivially REJECT.` }); summary.result = 'rejected'; break }
      const c = c1 || c2
      let x = 0, y = 0
      if (c & 8) { x = x1 + ((x2 - x1) * (win[3] - y1)) / (y2 - y1); y = win[3] } else if (c & 4) { x = x1 + ((x2 - x1) * (win[1] - y1)) / (y2 - y1); y = win[1] } else if (c & 2) { y = y1 + ((y2 - y1) * (win[2] - x1)) / (x2 - x1); x = win[2] } else { y = y1 + ((y2 - y1) * (win[0] - x1)) / (x2 - x1); x = win[0] }
      const edge = c & 8 ? 'top' : c & 4 ? 'bottom' : c & 2 ? 'right' : 'left'
      frames.push({ draw: draw([x1, y1, x2, y2], [...info, dot(pl.X(x), pl.Y(y), 5, undefined, 'rose', { solid: true })]), note: `Not trivially decided: move the outside endpoint to the ${edge} edge → (${fmt(x, 2)}, ${fmt(y, 2)}), then re-test.` })
      if (c === c1) { x1 = x; y1 = y } else { x2 = x; y2 = y }
    }
  } else {
    const dx = x2 - x1, dy = y2 - y1
    const pp = [-dx, dx, -dy, dy], qq = [x1 - win[0], win[2] - x1, y1 - win[1], win[3] - y1], names = ['left', 'right', 'bottom', 'top']
    let t0 = 0, t1 = 1, reject = false
    frames.push({ draw: draw(ln), note: 'Liang–Barsky writes the line as P(t) = P1 + t·(P2−P1), 0 ≤ t ≤ 1, and clips the parameter interval [t0, t1] against each edge.' })
    for (let k = 0; k < 4 && !reject; k++) {
      if (pp[k] === 0) { if (qq[k] < 0) reject = true; frames.push({ draw: draw(ln), note: `${names[k]}: the line is parallel to this edge; it is ${qq[k] < 0 ? 'outside → rejected' : 'inside — no change'}.` }); continue }
      const r = qq[k] / pp[k]
      if (pp[k] < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r)
      const cur = [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy]
      frames.push({ draw: draw(cur, [txt(430, 60, `t0 = ${fmt(t0, 4)}`, { size: 12, mono: true }), txt(430, 82, `t1 = ${fmt(t1, 4)}`, { size: 12, mono: true })]), note: `${names[k]} edge: p = ${fmt(pp[k], 2)}, q = ${fmt(qq[k], 2)} → r = ${fmt(r, 4)}; it ${pp[k] < 0 ? 'raises t0' : 'lowers t1'} to ${fmt(pp[k] < 0 ? t0 : t1, 4)}.` })
      if (t0 > t1) reject = true
    }
    if (reject || t0 > t1) summary.result = 'rejected'
    else { x2 = x1 + t1 * dx; y2 = y1 + t1 * dy; x1 = x1 + t0 * dx; y1 = y1 + t0 * dy; summary.result = `${fmt(x1, 2)},${fmt(y1, 2)} ${fmt(x2, 2)},${fmt(y2, 2)}` }
    frames.push({ draw: summary.result === 'rejected' ? draw([ln[0], ln[1], ln[0], ln[1]]) : draw([x1, y1, x2, y2]), note: summary.result === 'rejected' ? 't0 > t1: nothing of the line lies inside the window.' : `Result: t0 = ${fmt(t0, 4)}, t1 = ${fmt(t1, 4)}.` })
  }
  return trace(640, 330, frames, summary)
}

// ── 2-D transformations ─────────────────────────────────────────────────────

type M3 = number[][]
const mul = (a: M3, b: M3): M3 => a.map((_, i) => b[0].map((__, j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]))
const I3: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const T = (tx: number, ty: number): M3 => [[1, 0, tx], [0, 1, ty], [0, 0, 1]]
const Rz = (deg: number): M3 => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]] }
const S = (sx: number, sy: number): M3 => [[sx, 0, 0], [0, sy, 0], [0, 0, 1]]

function transformRun(p: Params) {
  const verts = prows(p, 'shape', [['1', '1'], ['4', '1'], ['2', '3']]).map((r) => r.map(Number))
  const ops = pstr(p, 'ops', 'translate 2 3; rotate 90 about 1 1; scale 0.5').split(/[;\n]/).map((o) => o.trim()).filter(Boolean)
  const mats: { m: M3; label: string }[] = []
  for (const op of ops) {
    const t = op.split(/\s+/), a = t.slice(1).filter((x) => x !== 'about').map(Number)
    const about = t.includes('about') ? a.slice(-2) : null
    let m: M3
    if (t[0] === 'translate') m = T(a[0], a[1])
    else if (t[0] === 'rotate') m = Rz(a[0])
    else if (t[0] === 'scale') m = S(a[0], a[1] ?? a[0])
    else if (t[0] === 'reflect') m = t[1] === 'x' ? S(1, -1) : t[1] === 'y' ? S(-1, 1) : [[0, 1, 0], [1, 0, 0], [0, 0, 1]]
    else if (t[0] === 'shear') m = t[1] === 'x' ? [[1, Number(t[2]), 0], [0, 1, 0], [0, 0, 1]] : [[1, 0, 0], [Number(t[2]), 1, 0], [0, 0, 1]]
    else throw new LabError(`unknown operation "${op}" — translate tx ty | rotate deg [about x y] | scale s | reflect x|y|xy | shear x|y k`)
    if (about) m = mul(T(about[0], about[1]), mul(m, T(-about[0], -about[1])))
    mats.push({ m, label: op })
  }
  const pts: number[][][] = [verts.map((v) => [...v])]
  let cur = verts.map((v) => [...v]); let comp: M3 = I3
  for (const { m } of mats) { comp = mul(m, comp); cur = cur.map(([x, y]) => [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]]); pts.push(cur.map((v) => [...v])) }
  const all = pts.flat(); const lo = Math.min(...all.map((q) => Math.min(q[0], q[1]))) - 1, hi = Math.max(...all.map((q) => Math.max(q[0], q[1]))) + 1
  const pl = makePlot(30, 30, 300, 300, lo, hi, lo, hi)
  const frames: Frame[] = pts.map((shape, k) => {
    const d: Prim[] = [heading(20, 14, '2-D transformations in homogeneous coordinates'), ...pl.axes]
    for (let i = 0; i < k; i++) d.push(poly(pts[i].map((v) => [pl.X(v[0]), pl.Y(v[1])]), 'dim', { closed: true, w: 1, dash: true }))
    d.push(poly(shape.map((v) => [pl.X(v[0]), pl.Y(v[1])]), toneAt(k), { closed: true, fill: true, w: 2 }))
    shape.forEach((v, i) => d.push(txt(pl.X(v[0]) + 6, pl.Y(v[1]) - 6, `(${fmt(v[0], 2)}, ${fmt(v[1], 2)})`, { size: 9.5, mono: true, tone: 'dim' })))
    let c: M3 = I3; for (let i = 0; i < k; i++) c = mul(mats[i].m, c)
    d.push(txt(350, 50, k === 0 ? 'original' : `after: ${mats[k - 1].label}`, { size: 12, mono: true, bold: true, tone: toneAt(k) }))
    c.forEach((row, i) => row.forEach((v, j) => d.push(txt(360 + j * 60, 90 + i * 22, fmt(v, 3), { size: 11.5, mono: true, anchor: 'middle' }))))
    d.push(txt(350, 170, 'composite matrix M = Mₖ⋯M₂M₁', { size: 10.5, tone: 'dim' }))
    return { draw: d, note: k === 0 ? 'A point (x, y) becomes the column (x, y, 1), so translation is also a matrix. Composite transformations multiply right to left: the FIRST operation is the rightmost matrix.' : `Apply ${mats[k - 1].label}. Order matters: rotating then translating is not the same as translating then rotating.` }
  })
  const last = pts[pts.length - 1]
  return trace(640, 350, frames, { vertices: last.map((v) => `(${fmt(v[0], 3)},${fmt(v[1], 3)})`).join(' ') })
}

// ── Bézier ──────────────────────────────────────────────────────────────────

function bezierRun(p: Params) {
  const P = prows(p, 'points', [['0', '0'], ['1', '3'], ['4', '3'], ['5', '0']]).map((r) => r.map(Number))
  if (P.length < 3 || P.length > 6 || P.some((r) => r.length !== 2 || r.some((v) => !Number.isFinite(v)))) throw new LabError('give 3–6 control points as x,y;x,y;…')
  const ts = pnums(p, 't', [0.25, 0.5, 0.75])
  const at = (t: number): { levels: number[][][]; pt: number[] } => { let cur = P; const levels = [cur]; while (cur.length > 1) { cur = cur.slice(1).map((q, i) => [(1 - t) * cur[i][0] + t * q[0], (1 - t) * cur[i][1] + t * q[1]]); levels.push(cur) } return { levels, pt: cur[0] } }
  const curvePts = Array.from({ length: 61 }, (_, i) => at(i / 60).pt)
  const xs = [...P, ...curvePts].map((q) => q[0]), ys = [...P, ...curvePts].map((q) => q[1])
  const pl = makePlot(30, 30, 380, 280, Math.min(...xs) - 0.5, Math.max(...xs) + 0.5, Math.min(...ys) - 0.5, Math.max(...ys) + 0.5)
  const frames: Frame[] = ts.map((t) => {
    const { levels, pt } = at(t)
    const d: Prim[] = [heading(20, 14, `de Casteljau · degree ${P.length - 1} Bézier · t = ${t}`), ...pl.axes, poly(curvePts.map((q) => [pl.X(q[0]), pl.Y(q[1])]), 'dim', { w: 1.6 })]
    levels.forEach((lv, k) => { if (lv.length > 1) d.push(poly(lv.map((q) => [pl.X(q[0]), pl.Y(q[1])]), toneAt(k), { w: 1.4, dash: k > 0 })); lv.forEach((q) => d.push(dot(pl.X(q[0]), pl.Y(q[1]), k === levels.length - 1 ? 6 : 3.5, undefined, k === levels.length - 1 ? 'amber' : toneAt(k), { solid: true }))) })
    P.forEach((q, i) => d.push(txt(pl.X(q[0]) + 7, pl.Y(q[1]) - 7, `P${i}`, { size: 10, mono: true, tone: 'dim' })))
    d.push(txt(430, 60, `B(${t}) = (${fmt(pt[0], 3)}, ${fmt(pt[1], 3)})`, { size: 12, mono: true, bold: true, tone: 'amber' }))
    return { draw: d, note: `Repeatedly interpolate between neighbouring points at the ratio t = ${t}: each level has one point fewer; the last point lies on the curve.` }
  })
  const half = at(0.5).pt
  return trace(640, 330, frames, { mid: `${fmt(half[0], 4)},${fmt(half[1], 4)}`, ...(P.length === 4 ? { formulaMid: `${fmt((P[0][0] + 3 * P[1][0] + 3 * P[2][0] + P[3][0]) / 8, 4)},${fmt((P[0][1] + 3 * P[1][1] + 3 * P[2][1] + P[3][1]) / 8, 4)}` } : {}) })
}

// ── 3-D viewing ─────────────────────────────────────────────────────────────

function project3dRun(p: Params) {
  const rx = pnum(p, 'rx', 25), ry = pnum(p, 'ry', 35), d = pnum(p, 'distance', 4), mode = pstr(p, 'mode', 'both')
  const V: number[][] = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z])
  const edges: number[][] = []; V.forEach((a, i) => V.forEach((b, j) => { if (i < j && a.filter((v, k) => v !== b[k]).length === 1) edges.push([i, j]) }))
  const rot = (v: number[]) => { const a = (rx * Math.PI) / 180, b = (ry * Math.PI) / 180; const y1 = v[1] * Math.cos(a) - v[2] * Math.sin(a), z1 = v[1] * Math.sin(a) + v[2] * Math.cos(a); return [v[0] * Math.cos(b) + z1 * Math.sin(b), y1, -v[0] * Math.sin(b) + z1 * Math.cos(b)] }
  const R = V.map(rot)
  const par = R.map((v) => [v[0], v[1]]), per = R.map((v) => { const w = d / (d - v[2]); return [v[0] * w, v[1] * w] })
  const cube = (pts: number[][], cx: number, tone: Tone, label: string, depth?: number[]): Prim[] => [
    ...edges.map(([i, j]) => line(cx + pts[i][0] * 60, 170 - pts[i][1] * 60, cx + pts[j][0] * 60, 170 - pts[j][1] * 60, tone, { w: depth ? 1.2 + (depth[i] + depth[j]) * 0.5 : 1.8 })),
    txt(cx, 275, label, { size: 11.5, anchor: 'middle', tone: 'dim' })]
  const frames: Frame[] = [
    { draw: [heading(20, 14, '3-D viewing pipeline'), ...cube(V.map((v) => [v[0] * 0.8 + v[2] * 0.3, v[1] * 0.8 + v[2] * 0.2]), 320, 'dim', 'model space (unit cube, unrotated)')], note: 'Model coordinates: a cube centred on the origin. The pipeline is model → world (rotate) → view → projection → screen.' },
    { draw: [heading(20, 14, '3-D viewing pipeline'), ...cube(par, 320, 'blue', `rotated ${rx}° about x, ${ry}° about y`)], note: `Rotate about x by ${rx}° and about y by ${ry}° (a composite 3-D transformation).` },
  ]
  if (mode !== 'perspective') frames.push({ draw: [heading(20, 14, 'Parallel (orthographic) projection'), ...cube(par, 320, 'mint', 'drop z: (x, y) — parallel lines stay parallel, size ignores depth')], note: 'Parallel projection simply discards z: sizes do not change with distance.' })
  if (mode !== 'parallel') frames.push({ draw: [heading(20, 14, 'Perspective projection'), ...cube(per, 320, 'amber', `x′ = x·d/(d−z),  d = ${d}: nearer points scale up`, R.map((v) => (v[2] + 1) / 2))], note: 'Perspective divides by depth: x′ = x·d/(d − z). Nearer edges (thicker) appear larger; parallel edges converge.' })
  if (mode === 'both') frames.push({ draw: [heading(20, 14, 'Parallel vs perspective'), ...cube(par, 170, 'mint', 'parallel'), ...cube(per, 470, 'amber', 'perspective')], note: 'Side by side: the perspective cube looks more natural because distant edges shrink.' })
  return trace(640, 300, frames, { v0parallel: `${fmt(par[0][0], 3)},${fmt(par[0][1], 3)}`, v0perspective: `${fmt(per[0][0], 3)},${fmt(per[0][1], 3)}` })
}

// ── Illumination ────────────────────────────────────────────────────────────

function phongRun(p: Params) {
  const ka = pnum(p, 'ka', 0.15), kd = pnum(p, 'kd', 0.6), ks = pnum(p, 'ks', 0.5), n = pnum(p, 'shininess', 20)
  const amb = () => ka, dif = (a: number) => kd * Math.max(0, Math.cos(a)), spec = (a: number) => ks * Math.pow(Math.max(0, Math.cos(2 * a)), n) // viewer along the normal, light at angle a → R·V = cos 2a
  const tot = (a: number) => amb() + dif(a) + spec(a)
  const pl = makePlot(40, 34, 400, 220, -90, 90, 0, Math.max(1, kd + ks + ka) * 1.05, { xticks: 6 })
  const layers: [string, (a: number) => number, Tone][] = [['ambient  ka', () => amb(), 'blue'], ['+ diffuse  kd·cosθ', (a) => amb() + dif(a), 'mint'], ['+ specular  ks·cosⁿ(2θ)', tot, 'amber']]
  const frames: Frame[] = layers.map((_, k) => {
    const d: Prim[] = [heading(20, 14, 'Phong illumination model — light angle θ from the surface normal'), ...pl.axes]
    for (let i = k; i >= 0; i--) d.push(pl.curve((x) => layers[i][1]((x * Math.PI) / 180), layers[i][2], i === k ? 2.4 : 1.2))
    layers.slice(0, k + 1).forEach(([l, , t], i) => d.push(txt(460, 60 + i * 22, l, { size: 11.5, mono: true, tone: t })))
    d.push(txt(460, 150, `at θ = 0: I = ${fmt(k === 0 ? ka : k === 1 ? ka + kd : tot(0), 3)}`, { size: 12, mono: true, bold: true }))
    return { draw: d, note: k === 0 ? 'Ambient light lights everything equally — a constant.' : k === 1 ? 'Diffuse (Lambert): intensity falls with the cosine of the angle between the light and the surface normal.' : `Specular highlight: a sharp peak where the reflection points at the viewer; a larger shininess n (now ${n}) makes it tighter.` }
  })
  return trace(640, 300, frames, { ambient: fmt(ka, 3), diffuseAt0: fmt(ka + kd, 3), totalAt0: fmt(tot(0), 3), totalAt60: fmt(tot(Math.PI / 3), 3) })
}

export const GFX_ENGINES: EngineDef[] = [
  { id: 'raster', label: 'Rasterisation', group: G, blurb: 'DDA and Bresenham lines, mid-point circle, flood fill — pixel by pixel.',
    params: [{ name: 'algo', label: 'Algorithm', hint: 'dda bresenham circle floodfill', def: 'bresenham', options: ['dda', 'bresenham', 'circle', 'floodfill'] }, { name: 'grid', label: 'Grid size', hint: '8–32', def: '16' }, { name: 'x1', label: 'x1', hint: 'line start', def: '2' }, { name: 'y1', label: 'y1', hint: '', def: '2' }, { name: 'x2', label: 'x2', hint: 'line end', def: '13' }, { name: 'y2', label: 'y2', hint: '', def: '8' }, { name: 'r', label: 'Radius', hint: 'circle', def: '6' }, { name: 'cx', label: 'cx', hint: 'circle centre', def: '8' }, { name: 'cy', label: 'cy', hint: '', def: '8' }, { name: 'polygon', label: 'Polygon', hint: 'flood fill boundary x,y;…', def: '3,3;12,3;12,10;7,13;3,10' }, { name: 'connect', label: 'Connectivity', hint: '4 | 8', def: '4', options: ['4', '8'] }], run: rasterRun },
  { id: 'clip', label: 'Line clipping', group: G, blurb: 'Cohen–Sutherland and Liang–Barsky against a rectangular window.',
    params: [{ name: 'algo', label: 'Algorithm', hint: 'cohen | liang', def: 'cohen', options: ['cohen', 'liang'] }, { name: 'window', label: 'Window', hint: 'xmin ymin xmax ymax', def: '20 20 80 70' }, { name: 'line', label: 'Line', hint: 'x1 y1 x2 y2', def: '5 10 95 80' }], run: clipRun },
  { id: 'transform2d', label: '2-D transformations', group: G, blurb: 'Translate, rotate, scale, reflect and shear — composed as homogeneous matrices.',
    params: [{ name: 'shape', label: 'Polygon', hint: 'x,y;x,y;…', def: '1,1;4,1;2,3' }, { name: 'ops', label: 'Operations', hint: 'translate 2 3; rotate 90 about 1 1; scale 2; reflect x; shear x 0.5', def: 'translate 2 3; rotate 90 about 1 1; scale 0.5', long: true }], run: transformRun },
  { id: 'bezier', label: 'Bézier curves', group: G, blurb: "de Casteljau's construction of a Bézier curve.",
    params: [{ name: 'points', label: 'Control points', hint: '3–6 points x,y;…', def: '0,0;1,3;4,3;5,0' }, { name: 't', label: 't values', hint: 'one frame each', def: '0.25 0.5 0.75' }], run: bezierRun },
  { id: 'project3d', label: '3-D projection', group: G, blurb: 'Rotate a cube and project it: parallel versus perspective.',
    params: [{ name: 'rx', label: 'Rotate x°', hint: '', def: '25' }, { name: 'ry', label: 'Rotate y°', hint: '', def: '35' }, { name: 'distance', label: 'Eye distance d', hint: 'perspective', def: '4' }, { name: 'mode', label: 'Show', hint: 'parallel | perspective | both', def: 'both', options: ['parallel', 'perspective', 'both'] }], run: project3dRun },
  { id: 'phong', label: 'Phong illumination', group: G, blurb: 'Ambient + diffuse + specular against the light angle.',
    params: [{ name: 'ka', label: 'ka (ambient)', hint: '', def: '0.15' }, { name: 'kd', label: 'kd (diffuse)', hint: '', def: '0.6' }, { name: 'ks', label: 'ks (specular)', hint: '', def: '0.5' }, { name: 'shininess', label: 'Shininess n', hint: '', def: '20' }], run: phongRun },
]
void box
