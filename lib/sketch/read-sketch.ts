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

/** How sure the network must be of a lone symbol for it to overrule the mechanics and optics readers. */
const LONE_SYMBOL_P = 0.6

/** A lone symbol is at most this many strokes (body, leads, a label). */
const MAX_LONE_STROKES = 8

/** The ink around the seed is no bigger than one symbol with its leads (about 2.5 times its body). */
function isOneSymbolWide(cluster: PlainStroke[], body: Box): boolean {
  const all = unionBox(cluster)
  const diag = (b: Box) => Math.hypot(b.x1 - b.x0, b.y1 - b.y0)
  return diag(all) <= 2.5 * diag(body) + 30
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

/** A hinge with a rod or rope to a ball that hangs below it (and, with `reach`, well below it). */
export function hasPendulum(g: MechGhost, reach = 0): boolean {
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
    if (h.cls !== 'hinge' || m.cls !== 'mass' || cy(m.id) <= cy(h.id) + 20) return false
    // `reach`: the bob hangs at least this many bob-widths from the pivot (a symbol's lead and circle sit close together)
    return reach === 0 || cy(m.id) - cy(h.id) >= Math.max(80, reach * m.bbox[3])
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

  // Mechanics parts are related by position, not touching (a ball above the ground), so the group is wider
  const mechCluster = connectedInk(strokes, seedId, 200)
  const mech = mechCluster.length >= 3 ? startMechGhost(pageId, mechCluster) : null
  const optics = mechCluster.length >= 3 ? startOpticsGhost(pageId, mechCluster) : null
  const opticsScore = optics?.optics ? opticsEvidence(optics.optics) : 0

  // The network settles a lone symbol. If everything that touches the seed is one symbol it names
  // with real confidence (a diode's triangle, a BJT's circle, a gate's body), no geometric reader
  // gets to call that a ramp, a ball or a block. It does not settle it when other ink nearby holds
  // mechanics or optics evidence of its own.
  const lone = pickNeural(net, seed.pts, cluster.filter((s) => s.id !== seedId), { minP: NEURAL_SHOW_P })
  if (lone.kind === 'place' && lone.p >= LONE_SYMBOL_P && cluster.length <= MAX_LONE_STROKES && isOneSymbolWide(cluster, lone.box)) {
    const group = new Set([seedId, ...lone.absorb])
    const rest = mechCluster.filter((s) => !group.has(s.id))
    // other ink nearby that reads as mechanics or optics (a ball over a hatched wall) outvotes the symbol
    const elsewhere = rest.length >= 2 && ((mech ? mechanicsEvidence(mech) >= 1.5 : false) || opticsScore >= 3)
    if (!elsewhere && !(mech && hasPendulum(mech, 2))) return { kind: 'symbol', pick: lone, ids: [seedId, ...lone.absorb] }
  }

  // The circuit reading, compared with the geometric ones. Several confident parts joined by wires
  // is a circuit: a handwritten "0" or a lamp's circle must not turn it into a lens bench.
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
  if (circuit && circuitScore >= 3 && circuit.result.ir.edges.length >= circuitScore - 1) return { kind: 'circuit', ghost: circuit }

  // A lens settles the rest: a mechanics sketch has no use for one. (Checked before the pulley, so a
  // lens drawn as a double arrow or a circle-with-a-beam is never mistaken for a pulley or a ball.)
  if (optics && opticsScore >= 3) return { kind: 'mechanics', ghost: optics }
  if (mech?.result?.gaps.length) {
    const gap = mech.result.gaps[0]
    return { kind: 'fail', failure: { reason: 'unsupported', message: gap.message, box: unionBox(mechCluster), ids: mechCluster.map((s) => s.id) } }
  }
  const mechScore = mech ? mechanicsEvidence(mech) : 0
  const pendulum = !!mech && hasPendulum(mech)

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
