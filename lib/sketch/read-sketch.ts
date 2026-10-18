// "Done drawing" → what the sketch is. One place that decides, for the ink around a
// seed stroke, whether it is a whole circuit, a single symbol, or nothing the
// network can name — and says WHY when it is nothing, so the person is told.
//
// Pure: takes plain strokes, returns a result. No stores, no DOM — testable in Node.

import { startCircuitGhost, type CircuitGhost } from './circuit-ghost'
import { NEURAL_SHOW_P, pickNeural, boxOf, type Box, type NeuralPick } from './neural-pick'

export interface PlainStroke {
  id: string
  /** Page-coordinate points. */
  pts: number[][]
}

type Net = Parameters<typeof startCircuitGhost>[2]

export type ReadFailure =
  | { reason: 'not-loaded'; message: string }
  | { reason: 'no-ink'; message: string }
  | { reason: 'error'; message: string }
  | { reason: 'unrecognised'; message: string; best?: { cls: string; p: number }; box: Box; ids: string[] }
  | { reason: 'not-connected'; message: string; box: Box; ids: string[]; parts: number }

export type ReadResult =
  | { kind: 'circuit'; ghost: CircuitGhost }
  | { kind: 'symbol'; pick: Extract<NeuralPick, { kind: 'place' }>; ids: string[] }
  | { kind: 'fail'; failure: ReadFailure }

/** Strokes whose boxes are within `gap` of the seed's, directly or through others. */
export function connectedInk(strokes: PlainStroke[], seedId: string, gap = 48): PlainStroke[] {
  const seed = strokes.find((s) => s.id === seedId)
  if (!seed) return []
  const boxes = new Map(strokes.map((s) => [s.id, boxOf(s.pts)]))
  const apart = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1))
  const inside = new Set<string>([seedId])
  const queue = [seed]
  while (queue.length && inside.size < 400) {
    const cur = queue.pop()!
    const cb = boxes.get(cur.id)!
    for (const s of strokes) {
      if (inside.has(s.id)) continue
      if (apart(cb, boxes.get(s.id)!) <= gap) {
        inside.add(s.id)
        queue.push(s)
      }
    }
  }
  return strokes.filter((s) => inside.has(s.id))
}

export function unionBox(strokes: PlainStroke[]): Box {
  return boxOf(strokes.flatMap((s) => s.pts))
}

/**
 * Read the sketch the seed stroke belongs to.
 *   1. four or more connected strokes that read as two or more parts joined by wires → a circuit;
 *   2. otherwise the seed (with the strokes touching it) as ONE symbol, shown even when unsure
 *      (the person confirms), down to NEURAL_SHOW_P;
 *   3. otherwise a failure that says what was seen and why it was not enough.
 */
export function readSketch(
  pageId: string,
  strokes: PlainStroke[],
  seedId: string,
  net: Net | null,
  charNet?: Parameters<typeof startCircuitGhost>[3]
): ReadResult {
  if (!net) return { kind: 'fail', failure: { reason: 'not-loaded', message: 'The sketch recogniser is still loading. Try again in a moment.' } }
  const seed = strokes.find((s) => s.id === seedId)
  const cluster = connectedInk(strokes, seedId)
  if (!seed || cluster.length === 0) return { kind: 'fail', failure: { reason: 'no-ink', message: 'There is no sketch here to read.' } }

  let circuitParts = 0
  if (cluster.length >= 4) {
    const g = startCircuitGhost(pageId, cluster, net, charNet)
    if (g) {
      circuitParts = g.result.parts.length
      if (g.result.parts.length >= 2 && g.result.ir.edges.length >= 1) return { kind: 'circuit', ghost: g }
    }
  }

  const others = cluster.filter((s) => s.id !== seedId)
  const pick = pickNeural(net, seed.pts, others, { minP: NEURAL_SHOW_P })
  if (pick.kind === 'place') return { kind: 'symbol', pick, ids: [seedId, ...pick.absorb] }

  const ids = [seedId, ...pick.absorb]
  const box = pick.box
  if (circuitParts >= 2) {
    return {
      kind: 'fail',
      failure: {
        reason: 'not-connected',
        parts: circuitParts,
        box,
        ids: cluster.map((s) => s.id),
        message: `Found ${circuitParts} parts but no wire joining them. Join the parts with wires, or choose the component yourself.`,
      },
    }
  }
  return { kind: 'fail', failure: { reason: 'unrecognised', message: "This doesn't look like a circuit symbol I know yet.", best: pick.best, box, ids } }
}
