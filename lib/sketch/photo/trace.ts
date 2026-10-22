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
 */
function mergeThroughJunctions(lines: Pt[][], reach: number): Pt[][] {
  const out = lines.map((l) => l.slice())
  const alive = out.map(() => true)
  // the direction a line LEAVES its end in (unit vector pointing away from the line)
  const outward = (i: number, start: boolean): Pt => {
    const l = out[i]
    const e = start ? l[0] : l[l.length - 1]
    let k = start ? 1 : l.length - 2
    let q = l[Math.max(0, Math.min(l.length - 1, k))]
    // use a point a few px back along the line, not the next vertex of a staircase
    let acc = 0
    const step = start ? 1 : -1
    while (acc < reach && k + step >= 0 && k + step < l.length) {
      q = l[k]
      acc = Math.hypot(e[0] - q[0], e[1] - q[1])
      k += step
    }
    const dx = e[0] - q[0]
    const dy = e[1] - q[1]
    const len = Math.hypot(dx, dy) || 1
    return [dx / len, dy / len]
  }
  for (let guard = 0; guard < 6 * lines.length + 8; guard++) {
    const ends: Array<{ i: number; start: boolean; p: Pt; d: Pt }> = []
    out.forEach((l, i) => {
      if (!alive[i]) return
      ends.push({ i, start: true, p: l[0], d: outward(i, true) })
      ends.push({ i, start: false, p: l[l.length - 1], d: outward(i, false) })
    })
    let best: { a: (typeof ends)[number]; b: (typeof ends)[number]; turn: number } | null = null
    for (const a of ends) {
      for (const b of ends) {
        if (b.i <= a.i) continue
        if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) > reach) continue
        // two ends continue each other when they point in opposite directions
        const cos = -(a.d[0] * b.d[0] + a.d[1] * b.d[1])
        const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
        if (turn <= 55 && (!best || turn < best.turn)) best = { a, b, turn }
      }
    }
    if (!best) break
    const A = best.a.start ? out[best.a.i].slice().reverse() : out[best.a.i]
    const B = best.b.start ? out[best.b.i] : out[best.b.i].slice().reverse()
    out[best.a.i] = [...A, ...B]
    alive[best.b.i] = false
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
export function traceStrokes(thick: Mask, skel: Mask): TraceResult {
  const { w, h } = skel
  const dt = distanceTransform(thick)
  const widths: number[] = []
  for (let i = 0; i < w * h; i++) if (skel.px[i]) widths.push(dt[i])
  widths.sort((a, b) => a - b)
  const strokeWidth = Math.max(1, 2 * (widths[Math.floor(widths.length / 2)] ?? 1))

  const edges = edgesOf(skel)
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
  for (const pts of mergeThroughJunctions(lines, Math.max(3, 2.2 * strokeWidth))) {
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
