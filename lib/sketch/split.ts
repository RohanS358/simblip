// Splitting one pen stroke into the things it draws.
//
// People do not draw a circuit one primitive per stroke. A real loop is usually: wire, zigzag, wire,
// coil, wire, corner, corner — one continuous line. The recogniser reads a stroke (or a group of
// strokes) as ONE symbol, so a stroke like that was read as a single "op-amp 21 %". Here a stroke is cut
// back into pieces: the WIGGLY runs (a zigzag, a coil: what a symbol body looks like) with a short lead
// either side, and the straight runs between them, which are wires and are cut again at their corners.
//
// Only long strokes are touched. A symbol drawn in one stroke with its leads (a resistor: lead, zigzag,
// lead) has one wiggly run and short leads, and is returned unchanged, as the network was trained on it.
//
// Pure geometry, no network: testable in Node.

import { dist, pathLength, rdp, type Pt } from './geom'

export interface SplitStroke {
  id: string
  pts: number[][]
}

/** Strokes shorter than this (× unit) are never split: a symbol with leads is about one unit long. */
const MIN_SPLIT_LEN_K = 1.35
/** A turn at least this sharp (degrees) counts as a corner/peak of a body. */
const SHARP_DEG = 55
/** At least this many sharp turns in a row, with short stretches between them, make a wiggly run (zigzag, coil). */
const MIN_RUN = 3
/** Stretches between turns inside a wiggly run are about this × unit or less (more if they stay regular). */
const RUN_EDGE_K = 0.6
/** A lead kept on each end of a body: at most this × unit. */
const LEAD_K = 0.2
/** A corner of a wire is a turn of at least this many degrees. */
const WIRE_CORNER_DEG = 40
/** A stroke is only cut when at least this much of it (× unit) is line outside the wiggly runs. */
const MIN_WIRE_K = 0.5
/** Pieces shorter than this (page px) are dropped as pen noise. */
const MIN_PIECE_PX = 4

const turnDeg = (a: Pt, b: Pt, c: Pt): number => {
  const h1 = Math.atan2(b[1] - a[1], b[0] - a[0])
  const h2 = Math.atan2(c[1] - b[1], c[0] - b[0])
  let d = Math.abs(h2 - h1)
  if (d > Math.PI) d = 2 * Math.PI - d
  return (d * 180) / Math.PI
}

/** Cumulative arc length at each point. */
function cumulative(pts: ArrayLike<number>[]): number[] {
  const out = [0]
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]))
  return out
}

/** The points between arc positions a and b, with the cut ends interpolated. */
function sliceByArc(pts: number[][], cum: number[], a: number, b: number): number[][] {
  const at = (s: number): number[] => {
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const seg = cum[i] - cum[i - 1]
    const t = seg > 0 ? (s - cum[i - 1]) / seg : 0
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]
  }
  const out: number[][] = [at(a)]
  for (let i = 0; i < pts.length; i++) if (cum[i] > a && cum[i] < b) out.push(pts[i])
  out.push(at(b))
  return out
}

interface Vertex {
  /** index into the simplified polyline */
  i: number
  /** arc position along the original stroke */
  s: number
  pt: Pt
}

/** The stroke's corners: RDP vertices with the arc position of each (the first and last included). */
function vertices(pts: number[][], cum: number[], eps: number): Vertex[] {
  const poly: Pt[] = pts.map((p) => [p[0], p[1]])
  const simp = rdp(poly, eps)
  const out: Vertex[] = []
  let k = 0
  for (const v of simp) {
    while (k < poly.length - 1 && (poly[k][0] !== v[0] || poly[k][1] !== v[1])) k++
    out.push({ i: out.length, s: cum[k], pt: v })
  }
  return out
}

/** A turn of the pen: consecutive nearby vertices (a rounded peak is two or three) taken as one. */
interface TurnEvent {
  /** arc position of its first and last vertex */
  s0: number
  s1: number
  /** total turn, degrees (a rounded peak adds up, a wiggle back and forth does not) */
  deg: number
}

function turnEvents(vs: Vertex[], U: number): TurnEvent[] {
  const events: TurnEvent[] = []
  const merge = Math.max(6, 0.14 * U)
  for (let k = 1; k < vs.length - 1; k++) {
    const h1 = Math.atan2(vs[k].pt[1] - vs[k - 1].pt[1], vs[k].pt[0] - vs[k - 1].pt[0])
    const h2 = Math.atan2(vs[k + 1].pt[1] - vs[k].pt[1], vs[k + 1].pt[0] - vs[k].pt[0])
    let d = h2 - h1
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    const deg = (d * 180) / Math.PI
    const last = events[events.length - 1]
    if (last && vs[k].s - last.s1 <= merge && Math.sign(deg) === Math.sign(last.deg)) {
      last.s1 = vs[k].s
      last.deg += deg
    } else events.push({ s0: vs[k].s, s1: vs[k].s, deg })
  }
  return events
}

/** Arc ranges [from, to] of the wiggly runs (zigzags, coils), each with its short leads. */
function wigglyRuns(vs: Vertex[], total: number, U: number): Array<[number, number]> {
  const ev = turnEvents(vs, U).filter((e) => Math.abs(e.deg) >= SHARP_DEG)
  const runs: Array<[number, number]> = []
  let from = 0
  const close = (to: number) => {
    // events from..to (inclusive) form one run
    if (to - from + 1 >= MIN_RUN) {
      const a = ev[from].s0
      const b = ev[to].s1
      const before = vs.filter((v) => v.s < a).pop()
      const after = vs.find((v) => v.s > b)
      const leadBefore = before ? a - before.s : 0
      const leadAfter = after ? after.s - b : 0
      runs.push([Math.max(0, a - Math.min(leadBefore, LEAD_K * U)), Math.min(total, b + Math.min(leadAfter, LEAD_K * U))])
    }
    from = to + 1
  }
  // A run is turns that keep coming at about the same spacing (peaks of a zigzag, loops of a coil). A wire
  // with a couple of corners has irregular, long stretches between them and never qualifies.
  for (let k = 1; k <= ev.length; k++) {
    if (k === ev.length) { close(k - 1); break }
    const gap = ev[k].s0 - ev[k - 1].s1
    const prev = k - 1 > from ? ev[k - 1].s0 - ev[k - 2].s1 : gap
    const regular = gap <= RUN_EDGE_K * U || (gap <= 1.2 * U && gap <= 2.2 * Math.max(prev, 1) && gap >= prev / 2.2)
    if (!regular) close(k - 1)
  }
  return runs
}

/** Cut a run of wire at its corners, so each piece is one straight line. */
function cutAtCorners(pts: number[][], cum: number[], a: number, b: number, out: number[][][]): void {
  if (b - a < MIN_PIECE_PX) return
  const piece = sliceByArc(pts, cum, a, b)
  if (piece.length < 2) return
  const pc = cumulative(piece)
  const vs = vertices(piece, pc, Math.max(2.5, 0.015 * pc[pc.length - 1]))
  let from = 0
  for (let k = 1; k < vs.length - 1; k++) {
    if (turnDeg(vs[k - 1].pt, vs[k].pt, vs[k + 1].pt) >= WIRE_CORNER_DEG) {
      if (vs[k].s - vs[from].s >= MIN_PIECE_PX) out.push(sliceByArc(piece, pc, vs[from].s, vs[k].s))
      from = k
    }
  }
  const last = vs[vs.length - 1]
  if (last.s - vs[from].s >= MIN_PIECE_PX) out.push(sliceByArc(piece, pc, vs[from].s, last.s))
}

/**
 * The pieces a stroke is made of, in drawing order. Returns the stroke itself when it is one thing.
 * `U` is the typical size of a whole symbol on the page (page px).
 */
export function splitStroke(s: SplitStroke, U: number): SplitStroke[] {
  if (s.pts.length < 4) return [s]
  const total = pathLength(s.pts)
  if (total < MIN_SPLIT_LEN_K * U) return [s]
  const cum = cumulative(s.pts)
  const vs = vertices(s.pts, cum, Math.max(2.5, 0.04 * U))
  if (vs.length < 3) return [s]
  const runs = wigglyRuns(vs, total, U)
  // Only strokes that hold a wiggly body AND a real stretch of other line (wire) are cut. A symbol drawn in
  // one stroke with its leads has nothing but short leads beside its body; a pure wire has no body.
  if (runs.length === 0) return [s]
  const bodyLen = runs.reduce((acc, [x, y]) => acc + (y - x), 0)
  if (total - bodyLen < MIN_WIRE_K * U) return [s]

  const pieces: Array<{ pts: number[][]; body: boolean }> = []
  const wires: number[][][] = []
  let at = 0
  const flushWire = (to: number) => {
    wires.length = 0
    cutAtCorners(s.pts, cum, at, to, wires)
    for (const w of wires) pieces.push({ pts: w, body: false })
  }
  for (const [a, b] of runs) {
    if (a > at) flushWire(a)
    pieces.push({ pts: sliceByArc(s.pts, cum, Math.max(a, at), b), body: true })
    at = b
  }
  if (at < total) flushWire(total)
  // nothing wiggly and no corner to cut at: it was one thing
  if (pieces.length <= 1) return [s]
  return pieces.map((p, k) => ({ id: `${s.id}#${k}`, pts: p.pts }))
}

/** The stroke a piece came from. */
export const baseId = (id: string): string => {
  const i = id.indexOf('#')
  return i < 0 ? id : id.slice(0, i)
}

/** Split every stroke; strokes that are one thing pass through untouched. */
export function splitStrokes<T extends SplitStroke>(strokes: T[], U: number): SplitStroke[] {
  return strokes.flatMap((s) => splitStroke(s, U))
}
