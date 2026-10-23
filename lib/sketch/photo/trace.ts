// Skeleton → pen strokes (phase S5).
//
// A 1-pixel skeleton is cut into the stretches between its ends and its junctions; each stretch becomes
// one stroke (a polyline). From there the photo is ordinary ink: the same splitter, the same wire / symbol
// grouping, the same SketchNet and the same circuit reader as a drawing made on the canvas. Nothing about
// reading a diagram is done twice.
//
// Filled junction dots are recognised by being much thicker than the lines and become the small looped dot
// the reader already knows. Filled SYMBOLS (a solid diode triangle) are not handled: their skeleton is not
// their outline. That is a stated limit of the first version.

import { rdp, type Pt } from '../geom'
import { distanceTransform, type Mask } from './raster'
import { MAX_LINE_PIECES, MAX_STROKES, NO_BUDGET, PhotoRefused, TOO_BUSY_MESSAGE, type Budget } from './budget'

export interface TraceResult {
  strokes: Array<{ id: string; pts: number[][] }>
  /** Median line width, px. */
  strokeWidth: number
  dots: number
  spursRemoved: number
}

const N8: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

/** Skeleton pixel count around p. */
function degreeAt(px: Uint8Array, w: number, h: number, p: number): number {
  const x = p % w
  const y = (p / w) | 0
  let n = 0
  for (const [dx, dy] of N8) {
    const xx = x + dx
    const yy = y + dy
    if (xx >= 0 && yy >= 0 && xx < w && yy < h && px[yy * w + xx]) n++
  }
  return n
}

interface Edge {
  pixels: number[]
  /** degrees of the first and last pixel (1 = free end, ≥ 3 = junction, 2 = closed loop) */
  d0: number
  d1: number
}

/** Cut the skeleton into edges between ends and junctions (and the odd closed loop). */
function edgesOf(skel: Mask): Edge[] {
  const { w, h, px } = skel
  const deg = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) if (px[i]) deg[i] = degreeAt(px, w, h, i)
  const isNode = (i: number) => deg[i] !== 2
  const used = new Uint8Array(w * h) // pixels already part of an edge (nodes may be shared)
  const edges: Edge[] = []
  const neighbours = (p: number): number[] => {
    const x = p % w
    const y = (p / w) | 0
    const out: number[] = []
    for (const [dx, dy] of N8) {
      const xx = x + dx
      const yy = y + dy
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && px[yy * w + xx]) out.push(yy * w + xx)
    }
    return out
  }
  const walk = (start: number, first: number): Edge => {
    const pixels = [start, first]
    let prev = start
    let cur = first
    while (!isNode(cur)) {
      used[cur] = 1
      const next = neighbours(cur).filter((q) => q !== prev && !(pixels.length > 2 && q === pixels[pixels.length - 2]))
      // prefer a 4-connected step over a diagonal one, so a staircase is followed cleanly
      next.sort((a, b) => Math.abs((a % w) - (cur % w)) + Math.abs(((a / w) | 0) - ((cur / w) | 0)) - (Math.abs((b % w) - (cur % w)) + Math.abs(((b / w) | 0) - ((cur / w) | 0))))
      const pick = next.find((q) => !used[q] || isNode(q))
      if (pick === undefined) break
      prev = cur
      cur = pick
      pixels.push(cur)
      if (pixels.length > w * h) break
    }
    return { pixels, d0: deg[pixels[0]], d1: deg[pixels[pixels.length - 1]] }
  }
  for (let i = 0; i < w * h; i++) {
    if (!px[i] || !isNode(i)) continue
    for (const q of neighbours(i)) {
      if (isNode(q)) {
        // two nodes side by side: a zero-length edge, nothing to draw
        continue
      }
      if (used[q]) continue
      edges.push(walk(i, q))
    }
  }
  // closed loops with no node on them
  for (let i = 0; i < w * h; i++) {
    if (!px[i] || used[i] || isNode(i)) continue
    const nb = neighbours(i)
    if (nb.length < 2) continue
    used[i] = 1
    const e = walk(i, nb[0])
    if (e.pixels.length > 6) edges.push({ ...e, d0: 2, d1: 2 })
  }
  return edges
}

/**
 * Thinning cuts a stroke wherever lines meet. A pen would not have lifted there: at a junction, the two line
 * ends that continue each other most smoothly were one stroke. Join those (and only those, and only when the
 * turn is gentle), so a zigzag or a wire along a rail is one stroke again, as it was drawn.
 *
 * Two ends meeting ALONE are one line however sharp the turn, but only between two SHORT pieces (the teeth
 * of a zigzag, the loops of a coil, broken at their tips): joining a long wire to a symbol at a sharp turn
 * would make one stroke of the two, which nothing can read. Where a third end is also there, only a gentle
 * continuation is joined.
 *
 * Near-linear: the line ends live in a grid of `reach`-sized cells, so the candidates for an end are found
 * in the 3×3 cells around it, and the best pair comes from a heap. (The first version re-scanned every pair
 * of ends after each join: cubic, minutes on a picture of graph paper.)
 */
function mergeThroughJunctions(lines: Pt[][], reach: number, fragment: number, budget: Budget): Pt[][] {
  const out = lines.map((l) => l.slice())
  const alive = out.map(() => true)
  const len = out.map((l) => l.reduce((acc, q, k) => acc + (k ? Math.hypot(q[0] - l[k - 1][0], q[1] - l[k - 1][1]) : 0), 0))
  // an "end" is addressed as 2·line (start) or 2·line + 1 (finish); `gen` changes whenever it is replaced
  const gen = new Int32Array(out.length * 2)
  const dir: Pt[] = new Array(out.length * 2)
  const pos = (e: number): Pt => (e & 1 ? out[e >> 1][out[e >> 1].length - 1] : out[e >> 1][0])
  const outward = (e: number): Pt => {
    const l = out[e >> 1]
    const start = (e & 1) === 0
    const p = start ? l[0] : l[l.length - 1]
    let k = start ? 1 : l.length - 2
    let q = l[Math.max(0, Math.min(l.length - 1, k))]
    // a point a few px back along the line, not the next vertex of a staircase
    let acc = 0
    const step = start ? 1 : -1
    while (acc < reach && k + step >= 0 && k + step < l.length) {
      q = l[k]
      acc = Math.hypot(p[0] - q[0], p[1] - q[1])
      k += step
    }
    const dx = p[0] - q[0]
    const dy = p[1] - q[1]
    const n = Math.hypot(dx, dy) || 1
    return [dx / n, dy / n]
  }
  // spatial hash of live ends
  const cell = Math.max(1, reach)
  const grid = new Map<number, Array<{ e: number; g: number }>>()
  const keyOf = (cx: number, cy: number) => cx * 73856093 + cy * 19349663
  const place = (e: number) => {
    const p = pos(e)
    const k = keyOf(Math.floor(p[0] / cell), Math.floor(p[1] / cell))
    const bucket = grid.get(k)
    if (bucket) bucket.push({ e, g: gen[e] })
    else grid.set(k, [{ e, g: gen[e] }])
  }
  const near = (e: number): number[] => {
    const p = pos(e)
    const cx = Math.floor(p[0] / cell)
    const cy = Math.floor(p[1] / cell)
    const res: number[] = []
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(keyOf(cx + ox, cy + oy))
        if (!bucket) continue
        for (const { e: f, g } of bucket) {
          if (f === e || g !== gen[f] || !alive[f >> 1]) continue
          const q = pos(f)
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= reach) res.push(f)
        }
      }
    }
    return res
  }
  for (let e = 0; e < out.length * 2; e++) {
    dir[e] = outward(e)
    place(e)
  }

  /** Score for joining ends a and b (lower is better; null = do not). */
  const evaluate = (a: number, b: number): number | null => {
    if (!alive[a >> 1] || !alive[b >> 1] || a >> 1 === b >> 1) return null
    const cos = -(dir[a][0] * dir[b][0] + dir[a][1] * dir[b][1])
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    const others = new Set<number>([...near(a), ...near(b)])
    others.delete(a)
    others.delete(b)
    const alone = others.size === 0
    const ok = alone ? turn <= 55 || (turn <= 170 && len[a >> 1] <= fragment && len[b >> 1] <= fragment) : turn <= 55
    if (!ok) return null
    return alone ? turn - 1000 : turn // meetings of exactly two ends go first
  }

  // min-heap of candidate joins
  interface Cand {
    s: number
    a: number
    b: number
    ga: number
    gb: number
  }
  const heap: Cand[] = []
  const push = (c: Cand) => {
    heap.push(c)
    let i = heap.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (heap[up].s <= heap[i].s) break
      ;[heap[up], heap[i]] = [heap[i], heap[up]]
      i = up
    }
  }
  const pop = (): Cand | undefined => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length && last) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l].s < heap[m].s) m = l
        if (r < heap.length && heap[r].s < heap[m].s) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  const offer = (a: number) => {
    for (const b of near(a)) {
      if (b >> 1 === a >> 1) continue
      const s = evaluate(a, b)
      if (s !== null) push({ s, a, b, ga: gen[a], gb: gen[b] })
    }
  }
  for (let e = 0; e < out.length * 2; e++) offer(e)

  let pops = 0
  const maxPops = 60 * out.length + 1000
  for (let c = pop(); c && pops++ < maxPops; c = pop()) {
    budget.check()
    if (gen[c.a] !== c.ga || gen[c.b] !== c.gb || !alive[c.a >> 1] || !alive[c.b >> 1]) continue
    const s = evaluate(c.a, c.b) // the neighbourhood may have changed since it was offered
    if (s === null) continue
    if (s > c.s + 1e-9) {
      push({ ...c, s })
      continue
    }
    const la = c.a >> 1
    const lb = c.b >> 1
    const A = (c.a & 1) === 0 ? out[la].slice().reverse() : out[la]
    const B = (c.b & 1) === 0 ? out[lb] : out[lb].slice().reverse()
    const gap = Math.hypot(A[A.length - 1][0] - B[0][0], A[A.length - 1][1] - B[0][1])
    out[la] = [...A, ...B]
    len[la] = len[la] + len[lb] + gap
    alive[lb] = false
    // the four old ends are gone; the joined line has two new ones
    for (const e of [2 * la, 2 * la + 1, 2 * lb, 2 * lb + 1]) gen[e]++
    for (const e of [2 * la, 2 * la + 1]) {
      dir[e] = outward(e)
      place(e)
    }
    offer(2 * la)
    offer(2 * la + 1)
  }
  return out.filter((_, i) => alive[i]).map((l) => rdp(l, 1.2))
}

/** Thick blobs (filled junction dots) from the pre-thinned mask. */
function findDots(thick: Mask, dt: Float32Array, strokeWidth: number): Array<{ x: number; y: number; r: number }> {
  const { w, h } = thick
  const T = Math.max(3.2, 1.7 * (strokeWidth / 2))
  const seen = new Uint8Array(w * h)
  const dots: Array<{ x: number; y: number; r: number }> = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (dt[s] < T || seen[s]) continue
    let sx = 0, sy = 0, n = 0, rmax = 0
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w
      const y = (p / w) | 0
      sx += x; sy += y; n++
      if (dt[p] > rmax) rmax = dt[p]
      for (const [dx, dy] of N8) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const q = yy * w + xx
        if (dt[q] >= T && !seen[q]) { seen[q] = 1; stack.push(q) }
      }
    }
    // a dot is compact: its thick core is about as wide as it is tall and not much bigger than a few line widths
    if (n >= 3 && rmax <= 3.2 * (strokeWidth / 2) + 2) dots.push({ x: sx / n + 0.5, y: sy / n + 0.5, r: rmax })
  }
  return dots
}

/**
 * Strokes from a thinned mask. `thick` is the mask BEFORE thinning (for line width and dots); `skel` is the
 * thinned one. Both are the same size.
 */
export function traceStrokes(thick: Mask, skel: Mask, budget: Budget = NO_BUDGET): TraceResult {
  const { w, h } = skel
  const dt = distanceTransform(thick)
  const widths: number[] = []
  for (let i = 0; i < w * h; i++) if (skel.px[i]) widths.push(dt[i])
  widths.sort((a, b) => a - b)
  const strokeWidth = Math.max(1, 2 * (widths[Math.floor(widths.length / 2)] ?? 1))

  const edges = edgesOf(skel)
  budget.check()
  // graph paper, a page of text, a busy scene: no diagram has this many separate lines
  if (edges.length > MAX_LINE_PIECES) throw new PhotoRefused(TOO_BUSY_MESSAGE)
  // a short branch off a junction is thinning's burr at a corner or a T, not a stroke
  const spur = Math.max(8, 3 * strokeWidth)
  let spursRemoved = 0
  const kept = edges.filter((e) => {
    const free = (e.d0 === 1) !== (e.d1 === 1) // one free end, one junction
    if (free && e.pixels.length < spur) { spursRemoved++; return false }
    return e.pixels.length >= 3
  })

  const lines: Pt[][] = []
  for (const e of kept) {
    const pts: Pt[] = e.pixels.map((p) => [(p % w) + 0.5, ((p / w) | 0) + 0.5])
    const simp = rdp(pts, Math.max(1.2, 0.5 * strokeWidth))
    if (simp.length >= 2) lines.push(simp)
  }
  const strokes: TraceResult['strokes'] = []
  let n = 0
  const grow = 0.9 * strokeWidth // thinning eats about a line width off every free end
  const joined = mergeThroughJunctions(lines, Math.max(3, 2.2 * strokeWidth), 28 * strokeWidth, budget)
  if (joined.length > MAX_STROKES) throw new PhotoRefused(TOO_BUSY_MESSAGE)
  for (const pts of joined) {
    const ext = (e: Pt, q: Pt): number[] => {
      const dx = e[0] - q[0]
      const dy = e[1] - q[1]
      const l = Math.hypot(dx, dy) || 1
      return [e[0] + (dx / l) * grow, e[1] + (dy / l) * grow]
    }
    const out: number[][] = pts.map((p) => [p[0], p[1]])
    if (pts.length >= 2) {
      out.unshift(ext(pts[0], pts[1]))
      out.push(ext(pts[pts.length - 1], pts[pts.length - 2]))
    }
    strokes.push({ id: `p${n++}`, pts: out })
  }
  const dots = findDots(thick, dt, strokeWidth)
  for (const d of dots) {
    const r = Math.min(5, Math.max(2.5, d.r))
    const ring: number[][] = []
    for (let k = 0; k <= 12; k++) {
      const a = (2 * Math.PI * k) / 12
      ring.push([d.x + r * Math.cos(a), d.y + r * Math.sin(a)])
    }
    strokes.push({ id: `p${n++}`, pts: ring })
  }
  return { strokes, strokeWidth, dots: dots.length, spursRemoved }
}
