// Scribble-to-erase: recognise a furious scratch-out, and find what it covers.
//
// Two decisions, both pure so they can be tested without a canvas:
//
//   isScribble      – is this stroke a scratch-out at all?
//   scribbleVictims – which objects did it cover?
//
// Detection works on the stroke's SHAPE, not its raw samples. The old version
// counted samples and summed turning over every jittery pointer event, so a
// fast scribble (few samples) was missed and a slow wobbly line (many noisy
// samples) could pass. Here the path is simplified first (RDP, in screen
// pixels, so zoom does not change what "a scribble" is), and only then is the
// turning and doubling-back measured.
//
// Victims are chosen by how much of each object the scribble actually passes
// over — ink by its own polyline, bodies by a grid of probe points — instead of
// bounding-box overlap, which missed a scratch across part of a long line and
// swallowed any object whose box the scribble merely enclosed.

import type { SceneObject } from './types'
import { inkPolyline, polyDist } from './erase'

type Pt = [number, number]
type P = { x: number; y: number }

/** Perpendicular-distance polyline simplification. */
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const dx = pts[b][0] - ax
    const dy = pts[b][1] - ay
    const l2 = dx * dx + dy * dy
    let worst = -1
    let wi = -1
    for (let i = a + 1; i < b; i++) {
      const t = l2 ? Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2)) : 0
      const d = Math.hypot(pts[i][0] - (ax + dx * t), pts[i][1] - (ay + dy * t))
      if (d > worst) { worst = d; wi = i }
    }
    if (worst > eps && wi > 0) {
      keep[wi] = 1
      stack.push([a, wi], [wi, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

export interface ScribbleShape {
  /** Bounding-box diagonal, screen px. */
  diag: number
  /** Path length ÷ diagonal — how much it doubles back on itself. */
  fold: number
  /** Total turning, radians (one full reversal is π). */
  turn: number
}

/** The measurements the decision is made from. `zoom` converts page → screen px. */
export function scribbleShape(pts: number[][], zoom: number): ScribbleShape {
  const scr: Pt[] = []
  for (const p of pts) {
    const q: Pt = [p[0] * zoom, p[1] * zoom]
    const last = scr[scr.length - 1]
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= 0.5) scr.push(q)
  }
  // 3 px swallows pointer jitter but keeps every deliberate reversal, however
  // small the scratch.
  const v = rdp(scr, 3)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of v) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  let len = 0
  let turn = 0
  let prev: number | null = null
  for (let i = 1; i < v.length; i++) {
    const dx = v[i][0] - v[i - 1][0]
    const dy = v[i][1] - v[i - 1][1]
    const d = Math.hypot(dx, dy)
    if (d < 1) continue
    len += d
    const ang = Math.atan2(dy, dx)
    if (prev !== null) {
      let t = Math.abs(ang - prev)
      if (t > Math.PI) t = 2 * Math.PI - t
      turn += t
    }
    prev = ang
  }
  const diag = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0
  return { diag, fold: diag > 0 ? len / diag : 0, turn }
}

/**
 * Is this stroke a scratch-out? `sensitivity` is the 0–1 pen setting: at 0 it
 * takes a long hard scribble, at 1 a quick zigzag is enough. A zigzag drawn on
 * empty canvas is still just ink — the caller only erases when something is
 * actually underneath.
 */
export function isScribble(pts: number[][], sensitivity: number, zoom: number): boolean {
  const k = Math.min(1, Math.max(0, sensitivity))
  const lerp = (a: number, b: number) => a + (b - a) * k
  if (pts.length < 8) return false
  const s = scribbleShape(pts, zoom)
  return s.diag >= 28 && s.fold >= lerp(5, 2.5) && s.turn >= lerp(6, 2.2) * Math.PI
}

const rotateAbout = (p: P, c: P, deg: number): P => {
  if (!deg) return p
  const r = (deg * Math.PI) / 180
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) }
}

/** Points spread along a polyline, at most `step` apart (always includes both ends). */
function along(poly: P[], step: number): P[] {
  const out: P[] = [poly[0]]
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]
    const b = poly[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let j = 1; j <= n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n })
  }
  return out
}

/** Fraction of an object that must lie under the scratch for it to go. */
const COVERED = 0.5

/**
 * The objects a scribble scratched out.
 *
 * How close counts as "under" adapts to the scribble itself: a dense scribble
 * has stripes a few px apart, a loose one leaves wide gaps, so the reach is set
 * from the average stripe gap (ink area ÷ path length) — clamped so a huge
 * lazy scribble still can't reach across the page.
 */
export function scribbleVictims(
  objects: Record<string, SceneObject> | SceneObject[],
  pts: number[][],
  zoom: number,
): string[] {
  if (pts.length < 2) return []
  const path: P[] = pts.map(([x, y]) => ({ x, y }))
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  let len = 0
  for (let i = 0; i < path.length; i++) {
    const { x, y } = path[i]
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
    if (i) len += Math.hypot(x - path[i - 1].x, y - path[i - 1].y)
  }
  if (len === 0) return []
  // Stripe gap and reach are judged in screen px, like detection, so the same
  // scratch erases the same things at any zoom.
  const gap = (((x1 - x0) * (y1 - y0)) / len) * zoom
  const reach = Math.min(30, Math.max(10, gap * 0.75)) / zoom
  const step = Math.max(4 / zoom, reach / 2)

  const covered = (p: P) => polyDist(p, path) <= reach
  const victims: string[] = []

  for (const o of Array.isArray(objects) ? objects : Object.values(objects)) {
    if (o.metadata.locked || o.metadata.render === 'system' || o.geometry.kind === 'group') continue
    // Cheap reject: the scratch (plus its reach) must touch the object's box.
    // A rotated body's box is not its footprint, so those are never rejected.
    if (
      !o.rotation &&
      (o.position.x > x1 + reach || o.position.x + o.size.w < x0 - reach ||
        o.position.y > y1 + reach || o.position.y + o.size.h < y0 - reach)
    ) continue

    let probes: P[]
    const poly = o.geometry.kind === 'stroke' || o.geometry.kind === 'line' ? inkPolyline(o) : null
    if (poly && poly.length) {
      probes = along(poly, step)
    } else {
      // Body: a 5×4 grid inset from the edge, so a box scratched through the
      // middle counts but one merely brushed along a side does not.
      const c = { x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 }
      probes = []
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 4; j++) {
          probes.push(rotateAbout({
            x: o.position.x + o.size.w * (0.1 + 0.8 * (i / 4)),
            y: o.position.y + o.size.h * (0.15 + 0.7 * (j / 3)),
          }, c, o.rotation ?? 0))
        }
      }
    }
    let hit = 0
    for (const p of probes) if (covered(p)) hit++
    if (hit / probes.length >= COVERED) victims.push(o.id)
  }
  return victims
}
