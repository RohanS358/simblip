// Deciding what a held symbol is, from SketchNet's answer. Pure, so the rules
// can be tested without a canvas.
//
// Two lessons from the first real strokes (a mouse-drawn resistor scored
// resistor 0.59 / unknown 0.34 — right, but far below a 0.9 bar tuned on
// generated data):
//
//  1. HOLDING THE PEN IS INTENT. The user chose to convert; the model's job is
//     to say WHICH symbol, not whether to bother. So the rule is about the best
//     real symbol, not about how sure the model is that it isn't "unknown", and
//     the bar is modest. The result is announced so a wrong guess is obvious.
//  2. SYMBOLS ARE MADE OF SEVERAL STROKES (battery plates, a gate's body, leads
//     and bubble). A hold only carries the last stroke, so the strokes just
//     before it and touching it are tried as one drawing, and win when they
//     read as a better symbol.

import type { SketchPrediction } from './sketchnet'

/** Lowest probability for the best non-'unknown' class to be accepted outright. */
export const NEURAL_MIN_P = 0.45
/** Lowest probability worth SHOWING in the ghost preview for the user to confirm
 *  or correct — a wrong-but-plausible guess is where a correction teaches most. */
export const NEURAL_SHOW_P = 0.15
/** Strokes drawn within this long of the hold can belong to the same symbol. */
export const NEURAL_GROUP_MS = 6000
/** How near (page px) another stroke must be to join the group. */
export const NEURAL_GROUP_PAD = 30
const MAX_GROUP = 7

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** A plain ink stroke already on the page, in page coordinates. */
export interface InkCandidate {
  id: string
  pts: number[][]
}

export type NeuralPick =
  | {
      kind: 'place'
      cls: string
      p: number
      pose: 0 | 90 | 180 | 270
      /** Other plausible symbols, most likely first (never 'unknown'). */
      alts: Array<{ cls: string; p: number }>
      absorb: string[]
      box: Box
    }
  | {
      kind: 'decline'
      message: string
      /** What it saw, when it saw anything symbol-like. */
      best?: { cls: string; p: number }
      /** The strokes it grouped and their box, so the person can still choose a component for them. */
      absorb: string[]
      box: Box
    }

export const boxOf = (pts: number[][]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

const near = (a: Box, b: Box, pad: number) =>
  a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1

/** The most likely REAL symbol in a prediction, ignoring 'unknown'. */
export function bestSymbol(pred: SketchPrediction): { cls: string; p: number } | null {
  const t = pred.top.find((x) => x.cls !== 'unknown')
  return t ? { cls: t.cls, p: t.conf } : null
}

type Net = { predict(strokes: number[][][]): SketchPrediction }

const altsOf = (pred: SketchPrediction, chosen: string) =>
  pred.top.filter((t) => t.cls !== 'unknown' && t.cls !== chosen).map((t) => ({ cls: t.cls, p: t.conf }))

export interface PickOptions {
  /** Lowest best-symbol probability to place/show. Default NEURAL_MIN_P. */
  minP?: number
  pad?: number
}

export function pickNeural(net: Net, points: number[][], recent: InkCandidate[], opts: PickOptions = {}): NeuralPick {
  const minP = opts.minP ?? NEURAL_MIN_P
  const pad = opts.pad ?? NEURAL_GROUP_PAD
  const single = net.predict([points])
  const sBest = bestSymbol(single)

  // Grow a group outward from the held stroke through touching recent strokes.
  let box = boxOf(points)
  const ids: string[] = []
  const strokes: number[][][] = [points]
  let grew = true
  while (grew && ids.length < MAX_GROUP - 1) {
    grew = false
    for (const r of recent) {
      if (ids.includes(r.id) || r.pts.length === 0) continue
      const rb = boxOf(r.pts)
      if (!near(box, rb, pad)) continue
      ids.push(r.id)
      strokes.push(r.pts)
      box = { x0: Math.min(box.x0, rb.x0), y0: Math.min(box.y0, rb.y0), x1: Math.max(box.x1, rb.x1), y1: Math.max(box.y1, rb.y1) }
      grew = true
      if (ids.length >= MAX_GROUP - 1) break
    }
  }
  const group = ids.length ? net.predict(strokes) : null
  const gBest = group ? bestSymbol(group) : null

  // The group wins only if it is a real improvement: a lone stroke that already
  // reads well must not swallow its neighbours.
  const useGroup = !!gBest && gBest.p >= minP && (!sBest || sBest.p < minP || gBest.p > sBest.p + 0.1)
  if (useGroup && gBest && group) {
    return { kind: 'place', cls: gBest.cls, p: gBest.p, pose: group.pose, alts: altsOf(group, gBest.cls), absorb: ids, box }
  }
  if (sBest && sBest.p >= minP) {
    return { kind: 'place', cls: sBest.cls, p: sBest.p, pose: single.pose, alts: altsOf(single, sBest.cls), absorb: [], box: boxOf(points) }
  }
  const seen = gBest && (!sBest || gBest.p > sBest.p) ? gBest : sBest
  return {
    kind: 'decline',
    best: seen ?? undefined,
    absorb: ids,
    box,
    message: seen
      ? `Neural recogniser: not sure enough (best guess ${seen.cls} ${Math.round(seen.p * 100)}%, needs ${Math.round(minP * 100)}%).`
      : "Neural recogniser: that doesn't look like a known symbol.",
  }
}
