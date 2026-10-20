// Reading an OPTICS sketch (phase S4): a light source, lenses, mirrors and a screen on an optical
// bench. Like mechanics, it is geometric: lenses are drawn as a lens outline or a double-headed
// vertical arrow, a mirror is a hatched line, a screen a bare vertical line, a source a circle
// (with an arrow for its beam), and tick marks on the axis give the focal length.
//
// Conventions (page px, y down):
//   • lens / mirror / screen are vertical lines: bbox = [cx − 1, cy − h/2, 2, h] before `angle`;
//     `angle` is the turn from vertical (a 45° mirror is 45);
//   • the light source is a circle; `angle` is its beam direction (0 = to the right);
//   • `values.f` is the focal length in px (negative diverges); the principal axis is not a part.

import { boxOf, dist, pathLength, type Box, type Pt } from './geom'
import {
  between, closedShape, deg, findArrows, findHatch, joinStrokes, lineAngle, mkLine, straightness, toSeg,
  type Line, type Primitive,
} from './mech'
import type { SketchIRType, SketchIRNode, SketchIRDoubt } from './ir'

export interface OpticStroke {
  id: string
  pts: number[][]
}

export type OpticCls = 'light-source' | 'thin-lens' | 'optical-mirror' | 'optical-screen'

export interface OpticPart {
  id: string
  cls: OpticCls
  conf: number
  box: Box
  angle: number
  strokeIds: string[]
  f?: number
}

export interface OpticsResult {
  ir: SketchIRType
  parts: OpticPart[]
  /** the principal axis and focal marks: part of the sketch, not parts of the scene */
  furnitureIds: string[]
  ignoredIds: string[]
  /** x of each focal mark found on the axis */
  marks: number[]
}

/** Focal length when nothing in the sketch says (the engine's own default). */
export const DEFAULT_FOCAL_PX = 150
/** A drawn lens outline is at least this tall (page px); anything smaller is handwriting. */
const MIN_LENS_PX = 48

const tiltOf = (theta: number) => {
  // a vertical line is 0; fold into (−90, 90]
  let t = theta - 90
  while (t <= -90) t += 180
  while (t > 90) t -= 180
  return Math.abs(t) < 2.5 ? 0 : t
}

const snapBeam = (a: number) => (Math.abs(a) <= 8 ? 0 : a)

const toPrims = (strokes: OpticStroke[]): Primitive[] =>
  joinStrokes(
    strokes
      .filter((s) => s.pts.length >= 2)
      .map((s) => {
        const pts: Pt[] = s.pts.map((p) => [p[0], p[1]])
        return { id: s.id, ids: [s.id], pts, box: boxOf(pts), len: pathLength(pts), p0: pts[0], p1: pts[pts.length - 1] }
      })
  )

/** A pair of short strokes meeting at `end`, folding back toward (mode 'back') or away from (mode 'out') the shaft. */
function headPair(s: Line, end: Pt, other: Pt, free: Line[], spent: Set<string>, mode: 'back' | 'out'): Line[] | null {
  const axis = mode === 'back' ? Math.atan2(other[1] - end[1], other[0] - end[0]) : Math.atan2(end[1] - other[1], end[0] - other[0])
  const heads = free.filter((h) => {
    if (h.id === s.id || spent.has(h.id) || h.len > 0.5 * s.len || h.len < 6) return false
    const tol = Math.max(10, 0.5 * h.len)
    const e = dist(h.p0, end) <= tol ? h.p1 : dist(h.p1, end) <= tol ? h.p0 : null
    if (!e) return false
    const a = Math.abs(((Math.atan2(e[1] - end[1], e[0] - end[0]) - axis + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
    return deg(a) >= 10 && deg(a) <= 68
  })
  const side = (h: Line) => {
    const e = dist(h.p0, end) <= dist(h.p1, end) ? h.p1 : h.p0
    return Math.sign((e[0] - end[0]) * (other[1] - end[1]) - (e[1] - end[1]) * (other[0] - end[0]))
  }
  const l = heads.filter((h) => side(h) > 0)
  const r = heads.filter((h) => side(h) < 0)
  return l.length && r.length ? [l[0], r[0]] : null
}

export function extractOptics(strokes: OpticStroke[]): OpticsResult {
  const prims = toPrims(strokes)
  const parts: OpticPart[] = []
  const doubts: SketchIRDoubt[] = []
  const used = new Set<string>()
  const furniture = new Set<string>()
  let nid = 0
  const newId = () => `n${++nid}`

  // closed shapes: lens outlines and circles
  const lensShapes: Array<{ p: Primitive; c: Extract<NonNullable<ReturnType<typeof closedShape>>, { kind: 'lens' }> }> = []
  const circles: Array<{ p: Primitive; cx: number; cy: number; r: number }> = []
  for (const p of prims) {
    const c = closedShape(p, { lens: true })
    if (!c) continue
    // a lens outline is a big shape; a small tall loop is a handwritten "0" or "Ω" in a value label
    if (c.kind === 'lens') { if (c.h >= c.w && c.h >= MIN_LENS_PX) lensShapes.push({ p, c }); else continue }
    else if (c.kind === 'circle') circles.push({ p, cx: c.cx, cy: c.cy, r: c.r })
    // a small, squarish loop is a rounded-off circle (a finger or a touchpad does this), not a block
    else if (c.kind === 'rect' && c.w / c.h > 0.6 && c.w / c.h < 1.67 && Math.hypot(c.w, c.h) < 70) circles.push({ p, cx: c.cx, cy: c.cy, r: (c.w + c.h) / 4 })
    else continue
    p.ids.forEach((i) => used.add(i))
  }

  const lines = prims.filter((p) => !p.ids.some((i) => used.has(i)) && p.len >= 6 && straightness(p) >= (p.len < 32 ? 0.7 : 0.82)).map(mkLine)
  const spent = new Set<string>()

  // double-headed vertical arrows are lenses: heads folding back = converging, folding out = diverging.
  // Claimed FIRST — four head strokes would otherwise look like hatching.
  const doubles: Array<{ s: Line; f: 1 | -1; heads: string[] }> = []
  for (const s of lines.slice().sort((a, b) => b.len - a.len)) {
    if (spent.has(s.id) || s.len < 40 || Math.abs(s.angle) < 68) continue
    const A = s.p0
    const B = s.p1
    for (const mode of ['back', 'out'] as const) {
      const a = headPair(s, A, B, lines, spent, mode)
      const b = a ? headPair(s, B, A, lines, new Set([...spent, ...a.map((h) => h.id)]), mode) : null
      if (a && b) {
        doubles.push({ s, f: mode === 'back' ? 1 : -1, heads: [...a, ...b].map((h) => h.id) })
        spent.add(s.id)
        for (const h of [...a, ...b]) spent.add(h.id)
        break
      }
    }
  }

  // beams: arrows whose tail is on a source circle. Claimed BEFORE hatching too — an arrow's two head
  // strokes sit right on the axis and would otherwise look like hatching along it.
  const beamArrows = findArrows(lines.filter((l) => !spent.has(l.id)), prims, used, new Map(), new Set()).arrows.filter((a) =>
    circles.some((c) => dist(a.tail, [c.cx, c.cy]) <= c.r + Math.max(10, 0.3 * c.r))
  )
  for (const a of beamArrows) {
    spent.add(a.shaft.id)
    a.heads.forEach((h) => spent.add(h))
  }

  const { hatchHost, tickTaken, hostsByLen } = findHatch(lines.filter((l) => !spent.has(l.id)))
  const free = lines.filter((l) => !tickTaken.has(l.id) && !hatchHost.has(l.id) && !spent.has(l.id))

  const rest = free.filter((l) => !spent.has(l.id))
  const arrows = beamArrows

  // ── the parts ─────────────────────────────────────────────────────────────────
  const boxFor = (cx: number, cy: number, len: number): Box => ({ x0: cx - 1, y0: cy - len / 2, x1: cx + 1, y1: cy + len / 2 })

  for (const { p, c } of lensShapes) {
    parts.push({ id: newId(), cls: 'thin-lens', conf: 0.8, box: boxFor(c.cx, c.cy, c.h), angle: Math.abs(c.angle) < 3 ? 0 : c.angle, strokeIds: p.ids, f: DEFAULT_FOCAL_PX })
  }
  for (const d of doubles) {
    const cx = (d.s.p0[0] + d.s.p1[0]) / 2
    const cy = (d.s.p0[1] + d.s.p1[1]) / 2
    parts.push({ id: newId(), cls: 'thin-lens', conf: 0.85, box: boxFor(cx, cy, d.s.len), angle: tiltOf(d.s.angle), strokeIds: [d.s.id, ...d.heads], f: d.f * DEFAULT_FOCAL_PX })
  }
  for (const h of hostsByLen) {
    if (!hatchHost.has(h.id)) continue
    const cx = (h.p0[0] + h.p1[0]) / 2
    const cy = (h.p0[1] + h.p1[1]) / 2
    parts.push({ id: newId(), cls: 'optical-mirror', conf: 0.85, box: boxFor(cx, cy, h.len), angle: tiltOf(h.angle), strokeIds: [h.id, ...(hatchHost.get(h.id) ?? [])], f: 0 })
  }

  // the principal axis: a long, level line that is not a hatched surface
  const axisLines = rest.filter((l) => !spent.has(l.id) && Math.abs(l.angle) < 8 && l.len >= 100)
  for (const a of axisLines) {
    a.id && furniture.add(a.id)
    spent.add(a.id)
  }
  const axisY = axisLines.length ? axisLines.reduce((m, a) => m + (a.p0[1] + a.p1[1]) / 2, 0) / axisLines.length : null

  // what is left, vertical: a screen (the rightmost) — or a lens drawn as a bare line
  const refLen = Math.max(0, ...parts.map((p) => p.box.y1 - p.box.y0))
  const bare = rest.filter((l) => !spent.has(l.id) && Math.abs(l.angle) >= 60 && l.len >= Math.max(40, 0.5 * refLen)).sort((a, b) => (b.p0[0] + b.p1[0]) - (a.p0[0] + a.p1[0]))
  bare.forEach((l, i) => {
    const cx = (l.p0[0] + l.p1[0]) / 2
    const cy = (l.p0[1] + l.p1[1]) / 2
    const id = newId()
    spent.add(l.id)
    if (i === 0) {
      parts.push({ id, cls: 'optical-screen', conf: parts.length ? 0.75 : 0.55, box: boxFor(cx, cy, l.len), angle: tiltOf(l.angle), strokeIds: [l.id] })
      if (!parts.length) doubts.push({ ref: id, why: 'low-confidence' })
    } else {
      parts.push({ id, cls: 'thin-lens', conf: 0.55, box: boxFor(cx, cy, l.len), angle: tiltOf(l.angle), strokeIds: [l.id], f: DEFAULT_FOCAL_PX })
      doubts.push({ ref: id, why: 'low-confidence' })
    }
  })

  // focal marks: short upright ticks (or specks) on the axis
  const lensesNow = parts.filter((p) => p.cls === 'thin-lens')
  const refH = Math.max(60, ...parts.map((p) => p.box.y1 - p.box.y0))
  const markY = axisY ?? (lensesNow.length ? (lensesNow[0].box.y0 + lensesNow[0].box.y1) / 2 : null)
  const marks: number[] = []
  if (markY !== null) {
    for (const l of lines) {
      if (spent.has(l.id) || tickTaken.has(l.id) || l.len > 0.3 * refH || Math.abs(l.angle) < 55) continue
      const cy = (l.p0[1] + l.p1[1]) / 2
      if (Math.abs(cy - markY) > Math.max(10, 0.12 * refH)) continue
      marks.push((l.p0[0] + l.p1[0]) / 2)
      furniture.add(l.id)
      spent.add(l.id)
    }
    for (const p of prims) {
      if (p.ids.some((i) => used.has(i) || spent.has(i))) continue
      if (p.len >= 24 || Math.hypot(p.box.x1 - p.box.x0, p.box.y1 - p.box.y0) > 14) continue
      const cy = (p.box.y0 + p.box.y1) / 2
      if (Math.abs(cy - markY) > Math.max(10, 0.12 * refH)) continue
      marks.push((p.box.x0 + p.box.x1) / 2)
      p.ids.forEach((i) => furniture.add(i))
    }
  }

  // light sources: circles (their beam arrow gives the direction)
  for (const c of circles) {
    const diag = 2 * c.r * Math.SQRT2
    const tail = (a: { tail: Pt; tip: Pt }) => dist(a.tail, [c.cx, c.cy]) <= c.r + Math.max(10, 0.3 * c.r)
    const mine = arrows.filter(tail)
    const beam = mine[0]
    const id = newId()
    parts.push({
      id,
      cls: 'light-source',
      conf: 0.8,
      box: { x0: c.cx - c.r, y0: c.cy - c.r, x1: c.cx + c.r, y1: c.cy + c.r },
      // a short hand-drawn arrow is only roughly at its angle: within 8° of level it was meant level
      angle: beam ? snapBeam(deg(Math.atan2(beam.tip[1] - beam.tail[1], beam.tip[0] - beam.tail[0]))) : 0,
      strokeIds: [...c.p.ids, ...mine.flatMap((a) => [a.shaft.id, ...a.heads])],
    })
    void diag
  }

  // focal length: from the marks on either side of a lens, else the engine's default
  for (const lens of parts.filter((p) => p.cls === 'thin-lens')) {
    const lx = (lens.box.x0 + lens.box.x1) / 2
    const ds = marks.map((m) => Math.abs(m - lx)).filter((d) => d >= 15).sort((a, b) => a - b)
    if (ds.length) lens.f = Math.sign(lens.f ?? 1) * Math.round(ds[0])
  }

  parts.sort((a, b) => a.box.x0 - b.box.x0)
  // renumber in left-to-right order, so "part 1" is the source
  const rename = new Map(parts.map((p, i) => [p.id, `n${i + 1}`]))
  for (const p of parts) p.id = rename.get(p.id)!
  for (const d of doubts) d.ref = rename.get(d.ref) ?? d.ref

  const nodes: SketchIRNode[] = parts.map((p) => ({
    id: p.id,
    cls: p.cls,
    conf: Math.round(p.conf * 100) / 100,
    bbox: [Math.round(p.box.x0 * 10) / 10, Math.round(p.box.y0 * 10) / 10, Math.round((p.box.x1 - p.box.x0) * 10) / 10, Math.round((p.box.y1 - p.box.y0) * 10) / 10],
    rot: 0,
    angle: Math.round(p.angle * 10) / 10,
    source: 'ink' as const,
    ...(p.f !== undefined && p.cls !== 'optical-screen' && p.cls !== 'light-source' && !(p.cls === 'optical-mirror' && p.f === 0) ? { values: { f: String(p.f) } } : {}),
  }))
  const claimed = new Set<string>([...parts.flatMap((p) => p.strokeIds), ...furniture])
  return {
    ir: { domain: 'optics', nodes, edges: [], labels: [], doubts },
    parts,
    furnitureIds: [...furniture],
    ignoredIds: prims.flatMap((p) => p.ids).filter((id) => !claimed.has(id)),
    marks,
  }
}

/**
 * How strongly this reads as optics rather than mechanics: a lens is the one thing a mechanics sketch
 * has no use for, so without one the score is zero (a hatched vertical line and a circle are as
 * likely to be a wall and a ball).
 */
export function opticsEvidence(r: OpticsResult): number {
  const lenses = r.parts.filter((p) => p.cls === 'thin-lens' && p.conf >= 0.7).length
  if (lenses < 1) return 0
  return 2 * lenses + r.parts.filter((p) => p.cls !== 'thin-lens').length
}

void between
void lineAngle
void toSeg
