// Small planar-geometry helpers for reading a drawing (extract.ts).

export type Pt = [number, number]

export interface Box { x0: number; y0: number; x1: number; y1: number }

export const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function boxOf(pts: ArrayLike<number>[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]
    if (p[0] > x1) x1 = p[0]
    if (p[1] < y0) y0 = p[1]
    if (p[1] > y1) y1 = p[1]
  }
  return { x0, y0, x1, y1 }
}

export const unionBox = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
})

export const diagOf = (b: Box) => Math.hypot(b.x1 - b.x0, b.y1 - b.y0)

/** Gap between two boxes (0 when they overlap). */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1)
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1)
  return Math.hypot(dx, dy)
}

export function pathLength(pts: ArrayLike<number>[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += dist(pts[i], pts[i - 1])
  return l
}

/** Perpendicular-distance polyline simplification (Ramer–Douglas–Peucker). */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1
    let wi = -1
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b])
      if (d > worst) { worst = d; wi = i }
    }
    if (worst > eps && wi > 0) {
      keep[wi] = 1
      stack.push([a, wi], [wi, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

export function segDist(p: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))
}

export function polyDist(p: ArrayLike<number>, poly: ArrayLike<number>[]): number {
  if (poly.length === 1) return dist(p, poly[0])
  let d = Infinity
  for (let i = 1; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i - 1], poly[i]))
  return d
}

/** Where two segments cross, or null. */
export function segCross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b[0] - a[0], ry = b[1] - a[1]
  const sx = d[0] - c[0], sy = d[1] - c[1]
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * rx, a[1] + t * ry] : null
}

/** Every point where two polylines cross. */
export function polyCrossings(a: Pt[], b: Pt[]): Pt[] {
  const out: Pt[] = []
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const x = segCross(a[i - 1], a[i], b[j - 1], b[j])
      if (x) out.push(x)
    }
  }
  return out
}

export const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Union-find over integer ids. */
export class Dsu {
  private p: number[]
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]]
      i = this.p[i]
    }
    return i
  }
  union(a: number, b: number) {
    this.p[this.find(a)] = this.find(b)
  }
}

/** Points `step` apart along a path (both ends kept). */
export function resamplePath(pts: ArrayLike<number>[], step: number): Pt[] {
  const out: Pt[] = [[pts[0][0], pts[0][1]]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = dist(a, b)
    if (seg === 0) continue
    let d = step - carry
    while (d <= seg) {
      const t = d / seg
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      d += step
    }
    carry = seg - (d - step)
  }
  const last = pts[pts.length - 1]
  if (dist(out[out.length - 1], last) > step * 0.3) out.push([last[0], last[1]])
  return out
}

/**
 * How much of a stroke runs along the axes, and how often it turns sharply.
 *
 * A hand-drawn wire wobbles, rounds its corners and may slant a little, so a
 * test on the simplified polyline's segments is fooled by one long wobbly
 * chord. This looks at the local direction instead, over short windows: a wire
 * spends nearly all its length within ~22° of horizontal or vertical and turns
 * a few times; a zigzag spends it at 60°; a coil never settles.
 */
export function axisStats(pts: ArrayLike<number>[], step = 6): { axisFraction: number; turns: number } {
  const r = resamplePath(pts, step)
  const W = 3
  if (r.length <= W) {
    const dx = Math.abs(r[r.length - 1][0] - r[0][0])
    const dy = Math.abs(r[r.length - 1][1] - r[0][1])
    const off = (Math.atan2(Math.min(dx, dy), Math.max(dx, dy)) * 180) / Math.PI
    return { axisFraction: off <= 22 ? 1 : 0, turns: 0 }
  }
  let onAxis = 0
  let total = 0
  const dirs: number[] = []
  for (let i = 0; i + W < r.length; i++) {
    const dx = r[i + W][0] - r[i][0]
    const dy = r[i + W][1] - r[i][1]
    const off = (Math.atan2(Math.min(Math.abs(dx), Math.abs(dy)), Math.max(Math.abs(dx), Math.abs(dy))) * 180) / Math.PI
    total++
    if (off <= 22) onAxis++
    if (i % W === 0) dirs.push(Math.atan2(dy, dx))
  }
  let turns = 0
  for (let i = 1; i < dirs.length; i++) {
    let d = Math.abs(dirs[i] - dirs[i - 1])
    if (d > Math.PI) d = 2 * Math.PI - d
    if (d > Math.PI / 3) turns++
  }
  return { axisFraction: total ? onAxis / total : 0, turns }
}
