// Reading a MECHANICS sketch: ground and ramps, blocks, balls, springs, ropes, rods, hinges
// and force/velocity arrows (AI plan Doc 2, phase S4).
//
// Unlike a circuit, a mechanics sketch has no wiring: POSITION is the information. A block
// "on" a ramp is a block whose bottom touches the ramp line; a spring "between" two things is a
// zigzag whose ends land on them. So this reader is geometric — primitives first (closed shapes,
// zigzags, straight lines), then relations (hatching, touching, arrow heads) — and it is
// deterministic: the same strokes always give the same IR. A learned model can later replace
// a primitive classifier without changing anything downstream (the IR is the contract).
//
// Conventions (page px, y down):
//   • a part's `bbox` is its box BEFORE `angle` is applied; the part turns about the box centre;
//   • `angle` is in degrees, screen frame (clockwise positive). A ramp rising to the right is −30°.
//   • ground: a static bar; a ramp is a ground bar that is not level.
//   • edges (spring / rope / rod) join parts at their centres, like connect(a.centre, b.centre).
//   • an arrow is a part: cls 'force' (default) or 'velocity', `angle` = its direction, values.on = the part it acts on.

import { boxOf, dist, median, pathLength, rdp, resamplePath, segDist, type Box, type Pt } from './geom'
import type { SketchIRType, SketchIRNode, SketchIREdge, SketchIRDoubt } from './ir'

export interface MechStroke {
  id: string
  pts: number[][]
}

export type MechCls = 'ground' | 'block' | 'mass' | 'hinge' | 'force' | 'velocity'

export interface MechPart {
  id: string
  cls: MechCls
  conf: number
  /** Box before `angle` is applied. */
  box: Box
  angle: number
  strokeIds: string[]
  /** ground / ramp: the surface line. */
  seg?: [Pt, Pt]
  /** a wedge's three corners, when the ramp was drawn as a triangle. */
  wedge?: Pt[]
  /** force/velocity: the part it acts on, and the tail→tip points. */
  on?: string
  arrow?: [Pt, Pt]
  /** block turned to lie flat on a ramp it touches. */
  snapped?: boolean
}

export interface MechEdge {
  id: string
  kind: 'spring' | 'rope' | 'rod'
  a: string
  b: string
  strokeIds: string[]
  conf: number
}

export interface MechGap {
  what: 'pulley'
  message: string
  ids: string[]
}

export interface MechResult {
  ir: SketchIRType
  parts: MechPart[]
  edges: MechEdge[]
  /** strokes that were read as nothing (stray marks, hatch ticks are NOT here — they belong to their line). */
  ignoredIds: string[]
  /** things the engine has no component for: reported, never guessed. */
  gaps: MechGap[]
  unit: number
}

// ── small geometry ──────────────────────────────────────────────────────────────

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

/** Direction p→q in degrees, folded into (−90, 90] — a line has no head. */
function lineAngle(p: Pt, q: Pt): number {
  let a = deg(Math.atan2(q[1] - p[1], q[0] - p[0]))
  if (a > 90) a -= 180
  if (a <= -90) a += 180
  return a
}

function hull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: Pt[] = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

const polyArea = (poly: Pt[]) => {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/** Smallest-area bounding rectangle of a convex polygon. `angle` is the turn of its sides, in (−45, 45]. */
function minAreaRect(h: Pt[]): { w: number; h: number; cx: number; cy: number; angle: number } {
  let best = { area: Infinity, w: 0, h: 0, cx: 0, cy: 0, angle: 0 }
  for (let a = 0; a < 90; a += 1) {
    const c = Math.cos(rad(a))
    const s = Math.sin(rad(a))
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of h) {
      const u = x * c + y * s
      const v = -x * s + y * c
      if (u < x0) x0 = u
      if (u > x1) x1 = u
      if (v < y0) y0 = v
      if (v > y1) y1 = v
    }
    const area = (x1 - x0) * (y1 - y0)
    if (area < best.area) {
      const mu = (x0 + x1) / 2
      const mv = (y0 + y1) / 2
      best = { area, w: x1 - x0, h: y1 - y0, cx: mu * c - mv * s, cy: mu * s + mv * c, angle: a }
    }
  }
  let angle = best.angle
  let { w, h: hh } = best
  if (angle > 45) angle -= 90
  if (best.angle > 45) [w, hh] = [hh, w]
  return { w, h: hh, cx: best.cx, cy: best.cy, angle }
}

/** Where p falls along the segment ab, 0 at a and 1 at b. */
const segProj = (p: ArrayLike<number>, a: Pt, b: Pt) => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(1e-9, dx * dx + dy * dy)
}

/** Distance from p to the segment ab. */
const toSeg = (p: ArrayLike<number>, a: Pt, b: Pt) => segDist(p, a, b)

function rotPoly(cx: number, cy: number, w: number, h: number, angle: number): Pt[] {
  const c = Math.cos(rad(angle))
  const s = Math.sin(rad(angle))
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
}

/** Distance from p to a convex polygon's area (0 inside). */
function toPoly(p: Pt, poly: Pt[]): number {
  let inside = true
  let d = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    d = Math.min(d, toSeg(p, a, b))
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (cr < 0) inside = false
  }
  return inside ? 0 : d
}

// ── primitives ──────────────────────────────────────────────────────────────────

export interface Primitive {
  id: string
  /** every stroke this primitive is made of (more than one when two strokes were joined) */
  ids: string[]
  pts: Pt[]
  box: Box
  len: number
  p0: Pt
  p1: Pt
}

export type Closed =
  | { kind: 'circle'; cx: number; cy: number; r: number; conf: number }
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number; angle: number; conf: number }
  | { kind: 'tri'; verts: Pt[]; conf: number }

export function closedShape(p: Primitive): Closed | null {
  const diag = Math.hypot(p.box.x1 - p.box.x0, p.box.y1 - p.box.y0)
  if (p.len < 24 || diag < 14) return null
  // a loop: the ends meet (a hand leaves a gap, or overshoots)
  if (dist(p.p0, p.p1) > 0.28 * p.len) return null
  const res = resamplePath(p.pts, Math.max(2, p.len / 80))
  if (res.length < 8) return null
  const h = hull(res)
  if (h.length < 3) return null
  const hullA = polyArea(h)
  const rect = minAreaRect(h)
  const rectA = Math.max(1, rect.w * rect.h)
  const fill = hullA / rectA
  const cx = res.reduce((a, q) => a + q[0], 0) / res.length
  const cy = res.reduce((a, q) => a + q[1], 0) / res.length
  const radii = res.map((q) => Math.hypot(q[0] - cx, q[1] - cy))
  const mr = radii.reduce((a, b) => a + b, 0) / radii.length
  const cv = Math.sqrt(radii.reduce((a, b) => a + (b - mr) ** 2, 0) / radii.length) / Math.max(1e-6, mr)
  const aspect = rect.w / Math.max(1e-6, rect.h)
  // a square is 1.0 of its bounding rectangle, a circle 0.785; rounded, wobbly squares land in between
  if (fill >= 0.87) {
    return { kind: 'rect', cx: rect.cx, cy: rect.cy, w: rect.w, h: rect.h, angle: Math.abs(rect.angle) < 3 ? 0 : rect.angle, conf: Math.max(0.55, Math.min(0.97, 0.6 + (fill - 0.9) * 4)) }
  }
  // a small circle's wobble is large next to its radius, so the bar loosens as it shrinks
  if (cv < 0.16 + 1.5 / Math.max(6, mr) && aspect > 0.62 && aspect < 1.6) {
    return { kind: 'circle', cx, cy, r: (rect.w + rect.h) / 4, conf: Math.max(0.5, Math.min(0.97, 0.9 - cv)) }
  }
  if (fill < 0.8) {
    // The corners of a hand-drawn triangle are rounded, so look for the three hull points that span
    // the most area: if that triangle is nearly the whole hull, the shape is a triangle.
    const hp = h.length > 36 ? h.filter((_, i) => i % Math.ceil(h.length / 36) === 0) : h
    let best: Pt[] | null = null
    let bestA = 0
    for (let i = 0; i < hp.length; i++)
      for (let j = i + 1; j < hp.length; j++)
        for (let k = j + 1; k < hp.length; k++) {
          const a = polyArea([hp[i], hp[j], hp[k]])
          if (a > bestA) {
            bestA = a
            best = [hp[i], hp[j], hp[k]]
          }
        }
    if (best && bestA / Math.max(1, hullA) >= 0.78) return { kind: 'tri', verts: best, conf: 0.8 }
  }
  return null
}

/** A zigzag between two ends: how many times it swings across its own chord. */
function zigzag(p: Primitive): { swings: number; amp: number } | null {
  const chord = dist(p.p0, p.p1)
  if (chord < 30 || p.len / chord < 1.12) return null
  const ux = (p.p1[0] - p.p0[0]) / chord
  const uy = (p.p1[1] - p.p0[1]) / chord
  const res = resamplePath(p.pts, 3)
  const v = res.map((q) => -(q[0] - p.p0[0]) * uy + (q[1] - p.p0[1]) * ux)
  const amp = Math.max(...v.map(Math.abs))
  // hysteresis: wobble in a wire stays inside ±4 px, a spring swings well past it
  const h = Math.max(4.5, Math.min(9, 0.02 * chord))
  let side = 0
  let swings = 0
  for (const x of v) {
    if (Math.abs(x) < h) continue
    const s = x > 0 ? 1 : -1
    if (side !== 0 && s !== side) swings++
    side = s
  }
  return swings >= 5 && amp >= 7 ? { swings, amp } : null
}

const straightness = (p: Primitive) => dist(p.p0, p.p1) / Math.max(1, p.len)

/** Total-least-squares line through the stroke, with the ends projected onto it. */
function fitLine(pts: Pt[]): [Pt, Pt] {
  const n = pts.length
  const mx = pts.reduce((a, q) => a + q[0], 0) / n
  const my = pts.reduce((a, q) => a + q[1], 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2
    sxy += (x - mx) * (y - my)
    syy += (y - my) ** 2
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(th)
  const uy = Math.sin(th)
  let lo = Infinity, hi = -Infinity
  for (const [x, y] of pts) {
    const t = (x - mx) * ux + (y - my) * uy
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  // keep the stroke's own direction (first → last)
  const first = pts[0]
  const flip = (first[0] - mx) * ux + (first[1] - my) * uy > 0
  const a: Pt = [mx + (flip ? hi : lo) * ux, my + (flip ? hi : lo) * uy]
  const b: Pt = [mx + (flip ? lo : hi) * ux, my + (flip ? lo : hi) * uy]
  return [a, b]
}

interface Line {
  id: string
  p0: Pt
  p1: Pt
  len: number
  angle: number
}

const mkLine = (p: Primitive): Line => {
  const [a, b] = fitLine(p.pts)
  return { id: p.id, p0: a, p1: b, len: dist(a, b), angle: lineAngle(a, b) }
}

/** Angle between two lines in [0, 90]. */
const between = (a: number, b: number) => {
  const d = Math.abs(a - b) % 180
  return d > 90 ? 180 - d : d
}


/**
 * Two strokes that meet end to end and together make a loop (a rectangle or circle drawn in two
 * goes) or a spring (a long zigzag the hand lifted in the middle) are one primitive.
 */
function joinStrokes(prims: Primitive[]): Primitive[] {
  const taken = new Set<number>()
  const out: Primitive[] = []
  const merge = (a: Primitive, b: Primitive, ra: boolean, rb: boolean): Primitive => {
    const pa = ra ? a.pts.slice().reverse() : a.pts
    const pb = rb ? b.pts.slice().reverse() : b.pts
    const pts = [...pa, ...pb]
    return { id: a.id, ids: [...a.ids, ...b.ids], pts, box: boxOf(pts), len: pathLength(pts), p0: pts[0], p1: pts[pts.length - 1] }
  }
  for (let i = 0; i < prims.length; i++) {
    if (taken.has(i)) continue
    let joined: Primitive | null = null
    const a = prims[i]
    if (a.len >= 15 && straightness(a) < 0.93) {
      for (let j = i + 1; j < prims.length && !joined; j++) {
        if (taken.has(j)) continue
        const b = prims[j]
        if (b.len < 15) continue
        const reach = Math.max(10, 0.08 * Math.min(a.len, b.len))
        // a's tail to b's head, trying both ways round for b (and a reversed)
        for (const [ra, rb] of [[false, false], [false, true], [true, false], [true, true]] as Array<[boolean, boolean]>) {
          const aEnd = ra ? a.p0 : a.p1
          const bStart = rb ? b.p1 : b.p0
          if (dist(aEnd, bStart) > reach) continue
          const m = merge(a, b, ra, rb)
          const isLoop = dist(m.p0, m.p1) <= 0.12 * m.len && closedShape(m)
          const isSpring = !zigzag(a) || !zigzag(b) ? !!zigzag(m) : false
          if (isLoop || isSpring) {
            joined = m
            taken.add(j)
            break
          }
        }
      }
    }
    taken.add(i)
    out.push(joined ?? a)
  }
  return out
}

// ── the reader ──────────────────────────────────────────────────────────────────

export function extractMechanics(strokes: MechStroke[]): MechResult {
  let prims: Primitive[] = strokes
    .filter((s) => s.pts.length >= 2)
    .map((s) => {
      const pts: Pt[] = s.pts.map((p) => [p[0], p[1]])
      return { id: s.id, ids: [s.id], pts, box: boxOf(pts), len: pathLength(pts), p0: pts[0], p1: pts[pts.length - 1] }
    })
  prims = joinStrokes(prims)

  const parts: MechPart[] = []
  const edges: MechEdge[] = []
  const doubts: SketchIRDoubt[] = []
  const gaps: MechGap[] = []
  const used = new Set<string>()
  let nid = 0
  const newId = () => `n${++nid}`

  // 1. closed shapes → blocks, balls, hinges, wedges
  const closed: Array<{ p: Primitive; c: Closed }> = []
  for (const p of prims) {
    const c = closedShape(p)
    if (c) closed.push({ p, c })
  }
  const bodyDiags = closed.filter((x) => x.c.kind !== 'tri').map((x) => Math.hypot(x.p.box.x1 - x.p.box.x0, x.p.box.y1 - x.p.box.y0))
  const bigDiag = bodyDiags.length ? Math.max(...bodyDiags) : 0
  for (const { p, c } of closed) {
    p.ids.forEach((i) => used.add(i))
    const id = newId()
    if (c.kind === 'rect') {
      parts.push({ id, cls: 'block', conf: c.conf, box: { x0: c.cx - c.w / 2, y0: c.cy - c.h / 2, x1: c.cx + c.w / 2, y1: c.cy + c.h / 2 }, angle: c.angle, strokeIds: p.ids })
    } else if (c.kind === 'circle') {
      const diag = 2 * c.r * Math.SQRT2
      const small = (bodyDiags.length >= 2 && diag < 0.45 * bigDiag) || diag < 26
      parts.push({
        id,
        cls: small ? 'hinge' : 'mass',
        conf: c.conf,
        box: { x0: c.cx - c.r, y0: c.cy - c.r, x1: c.cx + c.r, y1: c.cy + c.r },
        angle: 0,
        strokeIds: p.ids,
      })
    } else {
      // a wedge: its slanted edge is the ramp
      const v = c.verts
      let best: { a: Pt; b: Pt; ang: number; len: number } | null = null
      for (let i = 0; i < 3; i++) {
        const a = v[i]
        const b = v[(i + 1) % 3]
        const ang = lineAngle(a, b)
        if (Math.abs(ang) < 6 || Math.abs(ang) > 84) continue
        const len = dist(a, b)
        if (!best || len > best.len) best = { a, b, ang, len }
      }
      if (!best) {
        nid--
        p.ids.forEach((i) => used.delete(i))
        continue
      }
      // The corners of a hand-drawn triangle are rounded off, which drags their positions (and a slope
      // taken from them). The slope is the line the stroke's own points lie along in the MIDDLE of the
      // edge; the ends are then where that line meets the triangle's base and its upright side.
      const mid = p.pts.filter((q) => {
        const t = segProj(q, best!.a, best!.b)
        return t > 0.18 && t < 0.82 && toSeg(q, best!.a, best!.b) <= 0.08 * best!.len
      })
      let edge: [Pt, Pt] = [best.a, best.b]
      if (mid.length >= 6) {
        const fit = fitLine(mid)
        const dx = fit[1][0] - fit[0][0]
        const dy = fit[1][1] - fit[0][1]
        const bx = p.box
        const low = best.a[1] > best.b[1] ? best.a : best.b
        const high = low === best.a ? best.b : best.a
        // base: y = box bottom; upright side: x = the box side the upper end is nearer to
        const sideX = Math.abs(high[0] - bx.x0) < Math.abs(high[0] - bx.x1) ? bx.x0 : bx.x1
        const atY = (y: number): Pt => [fit[0][0] + dx * ((y - fit[0][1]) / dy), y]
        const atX = (x: number): Pt => [x, fit[0][1] + dy * ((x - fit[0][0]) / dx)]
        if (Math.abs(dy) > 1e-6 && Math.abs(dx) > 1e-6) edge = [atY(bx.y1), atX(sideX)]
        // a slope that leaves the triangle's box means the fit was bad: keep the corners
        const inBox = (q: Pt) => q[0] >= bx.x0 - 6 && q[0] <= bx.x1 + 6 && q[1] >= bx.y0 - 6 && q[1] <= bx.y1 + 6
        if (!inBox(edge[0]) || !inBox(edge[1])) edge = [best.a, best.b]
      }
      const eLen = dist(edge[0], edge[1])
      const eAng = lineAngle(edge[0], edge[1])
      const th = 12
      const mx = (edge[0][0] + edge[1][0]) / 2
      const my = (edge[0][1] + edge[1][1]) / 2
      parts.push({
        id,
        cls: 'ground',
        conf: c.conf,
        box: { x0: mx - eLen / 2, y0: my - th / 2, x1: mx + eLen / 2, y1: my + th / 2 },
        angle: eAng,
        strokeIds: p.ids,
        seg: edge,
        wedge: v,
      })
    }
  }

  // 2. springs: zigzags
  const springs: Array<{ p: Primitive; z: { swings: number; amp: number } }> = []
  for (const p of prims) {
    if (p.ids.some((i) => used.has(i))) continue
    const z = zigzag(p)
    if (z) springs.push({ p, z })
  }
  for (const s of springs) s.p.ids.forEach((i) => used.add(i))

  // 3. straight lines: hatching, arrows, surfaces, ropes
  const lines: Line[] = prims.filter((p) => !p.ids.some((i) => used.has(i)) && p.len >= 6 && straightness(p) >= (p.len < 32 ? 0.7 : 0.82)).map(mkLine)
  const longest = lines.reduce((m, l) => Math.max(m, l.len), 0)

  // 3a. hatched hosts: a long line with ≥ 3 short ticks along one side
  const tickOf = (t: Line, h: Line): { foot: number } | null => {
    if (t.id === h.id || t.len < 6 || t.len > Math.min(0.32 * h.len, 60)) return null
    if (between(t.angle, h.angle) < 22) return null
    const dx = h.p1[0] - h.p0[0]
    const dy = h.p1[1] - h.p0[1]
    const L = Math.hypot(dx, dy)
    let bestD = Infinity
    let foot = 0
    for (const e of [t.p0, t.p1]) {
      const d = toSeg(e, h.p0, h.p1)
      if (d < bestD) {
        bestD = d
        foot = ((e[0] - h.p0[0]) * dx + (e[1] - h.p0[1]) * dy) / (L * L)
      }
    }
    return bestD <= 12 && foot > -0.05 && foot < 1.05 ? { foot } : null
  }
  const hatchHost = new Map<string, string[]>()
  const tickTaken = new Set<string>()
  const hostsByLen = lines.slice().sort((a, b) => b.len - a.len)
  for (const h of hostsByLen) {
    if (h.len < 40 || tickTaken.has(h.id)) continue
    const ticks = lines.filter((t) => !tickTaken.has(t.id) && tickOf(t, h))
    const feet = ticks.map((t) => tickOf(t, h)!.foot)
    if (ticks.length >= 3 && Math.max(...feet) - Math.min(...feet) >= 0.35) {
      hatchHost.set(h.id, ticks.map((t) => t.id))
      for (const t of ticks) tickTaken.add(t.id)
    }
  }

  // 3b. arrows: a shaft with two short head strokes (or one V) folding back from its tip
  const free = lines.filter((l) => !tickTaken.has(l.id) && !hatchHost.has(l.id))
  const arrows: Array<{ shaft: Line; tail: Pt; tip: Pt; heads: string[] }> = []
  const spent = new Set<string>()
  for (const s of free.slice().sort((a, b) => b.len - a.len)) {
    if (spent.has(s.id) || s.len < 22) continue
    for (const [tip, tail] of [[s.p1, s.p0], [s.p0, s.p1]] as Array<[Pt, Pt]>) {
      const back = [tail[0] - tip[0], tail[1] - tip[1]]
      const backAng = Math.atan2(back[1], back[0])
      const heads = free.filter((h) => {
        if (h.id === s.id || spent.has(h.id) || h.len > 0.65 * s.len || h.len < 6) return false
        const tol = Math.max(10, 0.5 * h.len)
        const e = dist(h.p0, tip) <= tol ? h.p1 : dist(h.p1, tip) <= tol ? h.p0 : null
        if (!e) return false
        const a = Math.abs(((Math.atan2(e[1] - tip[1], e[0] - tip[0]) - backAng + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
        return deg(a) >= 10 && deg(a) <= 68
      })
      const side = (h: Line) => {
        const e = dist(h.p0, tip) <= dist(h.p1, tip) ? h.p1 : h.p0
        return Math.sign((e[0] - tip[0]) * back[1] - (e[1] - tip[1]) * back[0])
      }
      const left = heads.filter((h) => side(h) > 0)
      const right = heads.filter((h) => side(h) < 0)
      if (left.length && right.length) {
        const hs = [left[0], right[0]]
        arrows.push({ shaft: s, tail, tip, heads: hs.map((h) => h.id) })
        spent.add(s.id)
        hs.forEach((h) => spent.add(h.id))
        break
      }
    }
  }
  // …or a V drawn in one stroke at the tip
  for (const s of free.slice().sort((a, b) => b.len - a.len)) {
    if (spent.has(s.id) || s.len < 22) continue
    for (const [tip, tail] of [[s.p1, s.p0], [s.p0, s.p1]] as Array<[Pt, Pt]>) {
      const v = prims.find((q) => {
        if (q.ids.some((i) => used.has(i)) || spent.has(q.id) || q.id === s.id || q.len > 0.9 * s.len || q.len < 12) return false
        const simp = rdp(q.pts, Math.max(2, 0.08 * q.len))
        if (simp.length !== 3) return false
        const vert = simp[1]
        if (dist(vert, tip) > Math.max(9, 0.3 * q.len)) return false
        const back = Math.atan2(tail[1] - tip[1], tail[0] - tip[0])
        const arm = (e: Pt) => Math.abs(((Math.atan2(e[1] - vert[1], e[0] - vert[0]) - back + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
        return deg(arm(simp[0])) >= 10 && deg(arm(simp[0])) <= 68 && deg(arm(simp[2])) >= 10 && deg(arm(simp[2])) <= 68
      })
      if (v) {
        arrows.push({ shaft: s, tail, tip, heads: [v.id] })
        spent.add(s.id)
        spent.add(v.id)
        break
      }
    }
  }

  // 3c. the remaining straight lines: surfaces (ground, ramps, walls), ropes and rods
  const rest = lines.filter((l) => !tickTaken.has(l.id) && !spent.has(l.id) && !hatchHost.has(l.id))
  const bodies = () => parts.filter((p) => p.cls === 'block' || p.cls === 'mass' || p.cls === 'hinge')
  const bodyDist = (p: MechPart, pt: Pt): number => {
    if (p.cls === 'block') {
      const cx = (p.box.x0 + p.box.x1) / 2
      const cy = (p.box.y0 + p.box.y1) / 2
      return toPoly(pt, rotPoly(cx, cy, p.box.x1 - p.box.x0, p.box.y1 - p.box.y0, p.angle))
    }
    const cx = (p.box.x0 + p.box.x1) / 2
    const cy = (p.box.y0 + p.box.y1) / 2
    return Math.max(0, Math.hypot(pt[0] - cx, pt[1] - cy) - (p.box.x1 - p.box.x0) / 2)
  }
  const unitGuess = (() => {
    const d = parts.filter((p) => p.cls === 'block' || p.cls === 'mass').map((p) => Math.hypot(p.box.x1 - p.box.x0, p.box.y1 - p.box.y0))
    if (d.length) return median(d)
    return Math.max(60, longest / 3)
  })()
  const tol = Math.max(10, 0.14 * unitGuess)

  const addSurface = (l: Line, hatched: boolean) => {
    const id = newId()
    const th = 14
    const cx = (l.p0[0] + l.p1[0]) / 2
    const cy = (l.p0[1] + l.p1[1]) / 2
    const ids = [l.id, ...(hatchHost.get(l.id) ?? [])]
    parts.push({
      id,
      cls: 'ground',
      conf: hatched ? 0.92 : 0.6,
      box: { x0: cx - l.len / 2, y0: cy - th / 2, x1: cx + l.len / 2, y1: cy + th / 2 },
      angle: Math.abs(l.angle) < 2.5 ? 0 : l.angle,
      strokeIds: ids,
      seg: [l.p0, l.p1],
    })
    if (!hatched) doubts.push({ ref: id, why: 'low-confidence' })
    return id
  }
  for (const h of hostsByLen) if (hatchHost.has(h.id)) addSurface(h, true)

  const surfaces = () => parts.filter((p) => p.cls === 'ground')
  // is a body resting on this unhatched line (its underside touches it)?
  const supports = (l: Line) =>
    bodies().some((b) => {
      if (b.cls === 'hinge') return false
      const cx = (b.box.x0 + b.box.x1) / 2
      const cy = (b.box.y0 + b.box.y1) / 2
      const lowest = b.cls === 'block'
        ? rotPoly(cx, cy, b.box.x1 - b.box.x0, b.box.y1 - b.box.y0, b.angle).sort((p, q) => q[1] - p[1])[0]
        : ([cx, b.box.y1] as Pt)
      return toSeg(lowest, l.p0, l.p1) <= tol
    })

  const ropeLines: Line[] = []
  for (const l of rest.sort((a, b) => b.len - a.len)) {
    const nearBodies = (pt: Pt) => bodies().filter((b) => bodyDist(b, pt) <= tol)
    const ends = [nearBodies(l.p0), nearBodies(l.p1)]
    const attached = ends.filter((e) => e.length > 0).length
    // a long line a body rests on, with nothing hanging from it, is a surface
    if (supports(l) && attached === 0) {
      addSurface(l, false)
      continue
    }
    if (supports(l) && l.len >= 1.4 * unitGuess && attached < 2) {
      addSurface(l, false)
      continue
    }
    if (attached === 0) {
      if (l.len >= 1.6 * unitGuess && surfaces().length === 0) addSurface(l, false)
      continue // a stray line: ignored (reported below)
    }
    ropeLines.push(l)
  }

  // 4. arrows become parts
  for (const a of arrows) {
    const id = newId()
    const dx = a.tip[0] - a.tail[0]
    const dy = a.tip[1] - a.tail[1]
    const len = Math.hypot(dx, dy)
    const cx = (a.tip[0] + a.tail[0]) / 2
    const cy = (a.tip[1] + a.tail[1]) / 2
    // acts on the body its tail leaves, or the body its head points into
    const cand = bodies().filter((b) => b.cls !== 'hinge')
    const tailHit = cand.map((b) => ({ b, d: bodyDist(b, a.tail) })).filter((x) => x.d <= tol).sort((p, q) => p.d - q.d)[0]
    const tipHit = cand.map((b) => ({ b, d: bodyDist(b, a.tip) })).filter((x) => x.d <= tol).sort((p, q) => p.d - q.d)[0]
    const on = (tailHit ?? tipHit)?.b.id
    parts.push({
      id,
      cls: 'force',
      conf: 0.8,
      box: { x0: cx - len / 2, y0: cy - 4, x1: cx + len / 2, y1: cy + 4 },
      angle: deg(Math.atan2(dy, dx)),
      strokeIds: [a.shaft.id, ...a.heads],
      arrow: [a.tail, a.tip],
      on,
    })
    if (!on) doubts.push({ ref: id, why: 'dangling-wire' })
  }

  // 5. snap a block that is lying on a ramp to the ramp's slope. A rectangle turned by a is also a
  // rectangle turned by a±90 with its sides swapped, so the representation nearest the slope is used.
  for (const b of parts.filter((p) => p.cls === 'block')) {
    const w0 = b.box.x1 - b.box.x0
    const h0 = b.box.y1 - b.box.y0
    const cx = (b.box.x0 + b.box.x1) / 2
    const cy = (b.box.y0 + b.box.y1) / 2
    const poly = rotPoly(cx, cy, w0, h0, b.angle)
    const lowest = poly.slice().sort((p, q) => q[1] - p[1])[0]
    const ramp = surfaces()
      .filter((s) => s.seg && Math.abs(s.angle) >= 8 && Math.abs(s.angle) <= 80)
      .map((s) => ({ s, d: toSeg(lowest, s.seg![0], s.seg![1]) }))
      .filter((x) => x.d <= tol)
      .sort((p, q) => p.d - q.d)[0]
    if (!ramp) continue
    const fold = (a: number) => {
      let x = a % 180
      if (x > 90) x -= 180
      if (x <= -90) x += 180
      return x
    }
    const options = [
      { a: b.angle, w: w0, h: h0 },
      { a: fold(b.angle + 90), w: h0, h: w0 },
    ].map((o) => ({ ...o, d: Math.abs(fold(o.a - ramp.s.angle)) }))
    const best = options.sort((p, q) => p.d - q.d)[0]
    if (Math.abs(b.angle) <= 14 || best.d <= 14) {
      const pick = Math.abs(b.angle) <= 14 ? options.find((o) => o.w === w0 && o.h === h0)! : best
      b.box = { x0: cx - pick.w / 2, y0: cy - pick.h / 2, x1: cx + pick.w / 2, y1: cy + pick.h / 2 }
      b.angle = ramp.s.angle
      b.snapped = true
    }
  }

  // 6. connectors: springs, ropes, rods
  const attachPart = (pt: Pt): { part: MechPart | null; d: number } => {
    let best: { part: MechPart | null; d: number } = { part: null, d: Infinity }
    for (const p of parts) {
      if (p.cls === 'force' || p.cls === 'velocity') continue
      const d = p.cls === 'ground' && p.seg ? toSeg(pt, p.seg[0], p.seg[1]) : bodyDist(p, pt)
      if (d < best.d) best = { part: p, d }
    }
    return best.d <= tol ? best : { part: null, d: best.d }
  }
  const anchorAt = (pt: Pt, strokeId: string): MechPart => {
    const id = newId()
    const r = 7
    const part: MechPart = { id, cls: 'hinge', conf: 0.5, box: { x0: pt[0] - r, y0: pt[1] - r, x1: pt[0] + r, y1: pt[1] + r }, angle: 0, strokeIds: [] }
    parts.push(part)
    doubts.push({ ref: strokeId, why: 'dangling-wire' })
    return part
  }
  const connect = (kind: MechEdge['kind'], p0: Pt, p1: Pt, strokeIds: string | string[], conf: number) => {
    const strokeId = Array.isArray(strokeIds) ? strokeIds[0] : strokeIds
    const a = attachPart(p0)
    const b = attachPart(p1)
    const na = a.part ?? anchorAt(p0, strokeId)
    const nb = b.part ?? anchorAt(p1, strokeId)
    if (na.id === nb.id) return
    edges.push({ id: `e${edges.length + 1}`, kind, a: na.id, b: nb.id, strokeIds: Array.isArray(strokeIds) ? strokeIds : [strokeIds], conf })
  }
  for (const s of springs) connect('spring', s.p.p0, s.p.p1, s.p.ids, 0.85)
  // A line from a hinge is a rod; so is any line hanging off the end of a rod (a double pendulum
  // is one rigid chain). The drawing of a rod and a rope is the same line, so this is a reading
  // of the layout, not of the stroke — shown in the preview, where it can be changed.
  const rodEnds = new Set<string>()
  const isRod = new Map<string, boolean>()
  for (const p of parts) if (p.cls === 'hinge') rodEnds.add(p.id)
  let grew = true
  while (grew) {
    grew = false
    for (const l of ropeLines) {
      if (isRod.get(l.id)) continue
      const a = attachPart(l.p0).part
      const b = attachPart(l.p1).part
      const touchesRod = [a, b].some((x) => x && rodEnds.has(x.id) && x.cls !== 'ground')
      if (touchesRod) {
        isRod.set(l.id, true)
        if (a && a.cls !== 'ground') rodEnds.add(a.id)
        if (b && b.cls !== 'ground') rodEnds.add(b.id)
        grew = true
      }
    }
  }
  for (const l of ropeLines) connect(isRod.get(l.id) ? 'rod' : 'rope', l.p0, l.p1, l.id, isRod.get(l.id) ? 0.8 : 0.75)

  // 7. what the engine has no component for: a pulley is a circle with ropes leaving it downward on both sides
  for (const c of parts.filter((p) => p.cls === 'mass')) {
    const cx = (c.box.x0 + c.box.x1) / 2
    const cy = (c.box.y0 + c.box.y1) / 2
    const r = (c.box.x1 - c.box.x0) / 2
    const hanging = ropeLines.filter((l) => {
      const top = l.p0[1] < l.p1[1] ? l.p0 : l.p1
      const bot = l.p0[1] < l.p1[1] ? l.p1 : l.p0
      return Math.hypot(top[0] - cx, top[1] - cy) <= r + tol && bot[1] - top[1] > 1.2 * r && Math.abs(bot[0] - top[0]) < 0.6 * (bot[1] - top[1]) && Math.abs(top[0] - cx) > 0.55 * r
    })
    const left = hanging.some((l) => (l.p0[1] < l.p1[1] ? l.p0 : l.p1)[0] < cx)
    const right = hanging.some((l) => (l.p0[1] < l.p1[1] ? l.p0 : l.p1)[0] > cx)
    if (left && right) {
      gaps.push({
        what: 'pulley',
        message: 'This looks like a pulley with a rope over it. SIMBLIP has no pulley component yet, so it cannot be built — draw the masses and ropes without the pulley, or ask for a pulley to be added.',
        ids: [...c.strokeIds, ...hanging.map((h) => h.id)],
      })
    }
  }

  // 8. assemble the IR
  const ignored = prims.flatMap((p) => p.ids).filter((id) => !parts.some((q) => q.strokeIds.includes(id)) && !edges.some((e) => e.strokeIds.includes(id)))

  const nodes: SketchIRNode[] = parts.map((p) => ({
    id: p.id,
    cls: p.cls,
    conf: Math.round(p.conf * 100) / 100,
    bbox: [Math.round(p.box.x0 * 10) / 10, Math.round(p.box.y0 * 10) / 10, Math.round((p.box.x1 - p.box.x0) * 10) / 10, Math.round((p.box.y1 - p.box.y0) * 10) / 10],
    rot: 0,
    angle: Math.round(p.angle * 10) / 10,
    source: 'ink' as const,
    ...(p.on ? { values: { on: p.on } } : {}),
  }))
  const irEdges: SketchIREdge[] = edges.map((e) => ({
    a: { node: e.a, pin: 'centre' },
    b: { node: e.b, pin: 'centre' },
    kind: e.kind,
    conf: e.conf,
  }))
  const unit = unitGuess
  return {
    ir: { domain: 'mechanics', nodes, edges: irEdges, labels: [], doubts },
    parts,
    edges,
    ignoredIds: ignored,
    gaps,
    unit,
  }
}
