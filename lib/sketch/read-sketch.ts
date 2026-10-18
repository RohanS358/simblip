// "Done drawing" → what the sketch is. One place that decides, for the ink around a
// seed stroke, whether it is a whole circuit, a single symbol, or nothing the
// network can name — and says WHY when it is nothing, so the person is told.
//
// Pure: takes plain strokes, returns a result. No stores, no DOM — testable in Node.

import { startCircuitGhost, type CircuitGhost } from './circuit-ghost'
import { NEURAL_SHOW_P, pickNeural, boxOf, type Box, type NeuralPick } from './neural-pick'
import { startMechGhost, startOpticsGhost, type MechGhost } from './mech-ghost'
import { opticsEvidence } from './optics'

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
  /** recognised, but the engine has no component for it (a pulley): said plainly, never guessed */
  | { reason: 'unsupported'; message: string; box: Box; ids: string[] }
  | { reason: 'unrecognised'; message: string; best?: { cls: string; p: number }; box: Box; ids: string[] }
  | { reason: 'not-connected'; message: string; box: Box; ids: string[]; parts: number }

export type ReadResult =
  | { kind: 'circuit'; ghost: CircuitGhost }
  | { kind: 'mechanics'; ghost: MechGhost }
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

/**
 * How strongly a mechanics reading looks like mechanics rather than a circuit. HARD evidence is
 * what a circuit sketch does not contain — a block (a drawn rectangle), a confidently hatched
 * ground or a wedge ramp; without at least one, the score is zero, because a zigzag, a circle
 * and a few lines are just as likely to be a resistor, a bulb and wires. SOFT evidence (balls,
 * arrows, springs and ropes) only adds to a reading that already has some.
 */
export function mechanicsEvidence(g: MechGhost): number {
  let hard = 0
  let soft = 0
  for (const p of g.result?.parts ?? []) {
    if (p.cls === 'block') hard++
    else if (p.cls === 'ground' && p.conf >= 0.85) hard++
    else if (p.cls === 'mass' || p.cls === 'force' || p.cls === 'velocity') soft++
  }
  if (hard < 1) return 0
  return hard + 0.7 * soft + 0.5 * (g.result?.edges.length ?? 0)
}

/** A hinge with a rod or rope to a ball that hangs below it. */
export function hasPendulum(g: MechGhost): boolean {
  const byId = new Map(g.ir.nodes.map((n) => [n.id, n]))
  const cy = (id: string) => {
    const n = byId.get(id)
    return n ? n.bbox[1] + n.bbox[3] / 2 : 0
  }
  return g.ir.edges.some((e) => {
    if (e.kind === 'spring') return false
    const a = byId.get(e.a.node)
    const b = byId.get(e.b.node)
    if (!a || !b) return false
    const [h, m] = a.cls === 'hinge' ? [a, b] : [b, a]
    return h.cls === 'hinge' && m.cls === 'mass' && cy(m.id) > cy(h.id) + 20
  })
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

  // Mechanics first as a candidate (ground, ramps, blocks, balls, springs, arrows), because a
  // hatched wall reads as a circuit "ground" symbol and a spring as a resistor. It must have real
  // mechanics evidence to win; a circuit reading with more confident parts beats it.
  // Mechanics parts are related by position, not touching (a ball above the ground), so the group is wider
  const mechCluster = connectedInk(strokes, seedId, 200)
  const mech = mechCluster.length >= 3 ? startMechGhost(pageId, mechCluster) : null
  // A lens settles it: a mechanics sketch has no use for one. (Checked first, so a lens drawn as a
  // double arrow or a circle-with-a-beam is never mistaken for a pulley or a ball.)
  const optics = mechCluster.length >= 3 ? startOpticsGhost(pageId, mechCluster) : null
  const opticsScore = optics?.optics ? opticsEvidence(optics.optics) : 0
  if (optics && opticsScore >= 3) return { kind: 'mechanics', ghost: optics }
  if (mech?.result?.gaps.length) {
    const gap = mech.result.gaps[0]
    return { kind: 'fail', failure: { reason: 'unsupported', message: gap.message, box: unionBox(mechCluster), ids: mechCluster.map((s) => s.id) } }
  }
  const mechScore = mech ? mechanicsEvidence(mech) : 0
  const pendulum = !!mech && hasPendulum(mech)

  let circuitParts = 0
  let circuit: CircuitGhost | null = null
  if (cluster.length >= 4) {
    const g = startCircuitGhost(pageId, cluster, net, charNet)
    if (g) {
      circuitParts = g.result.parts.length
      if (g.result.parts.length >= 2 && g.result.ir.edges.length >= 1) circuit = g
    }
  }
  const circuitScore = circuit ? circuit.result.parts.filter((p) => p.conf >= 0.8).length : 0
  if (mech && mechScore >= 1.5 && (!circuit || mechScore > circuitScore)) return { kind: 'mechanics', ghost: mech }
  // a pendulum has no block or hatched ground to point at, so it counts only when no circuit reading competes
  if (mech && pendulum && !circuit) return { kind: 'mechanics', ghost: mech }
  if (circuit) return { kind: 'circuit', ghost: circuit }

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
