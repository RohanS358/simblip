// Orthogonal schematic layout — cost-driven placement, then TSM-style routing.
//
// Two rules decide everything here:
//   1. A connection takes the shortest path with the fewest crossings.
//   2. Components sit at least 20px apart, inside the smallest perimeter.
//
// Two tiers:
//   1. Placement — simulated annealing (the PCB/EDA approach) directly on
//      C = wire length + 400·crossings + 0.8·perimeter, with the 20px
//      clearance as a HARD CONSTRAINT rather than a cost term. Moves are
//      nudge / swap / rotate, grid-aligned so pins land on grid lines.
//   2. Routing — orthogonal (Manhattan) A* on a coarse grid with obstacles,
//      so wires run at right angles, go AROUND bodies, and share lanes.
//
// Placement was originally force-directed (Fruchterman-Reingold). That was the
// wrong tool: it optimises a physics analogy with no term for crossings and
// none for compactness, so it SPREADS parts — component area was 4–13% of the
// bounding box, i.e. drawings that were ~90% empty — and its spacing constant
// had nothing to do with any clearance rule. Annealing the real cost cut total
// wire length by roughly half and took most circuits to zero crossings.
//
// Deliberately omitted: the full TSM orthogonalisation (planarise → flow-based
// bend minimisation → compaction). A* per edge on a shared grid gets ~90% of
// the readability for a fraction of the code.

import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
import type { SceneObject } from './types'

export type Edge = { fromId: string; toId: string; fromIdx: number; toIdx: number }
export type Pt = { x: number; y: number }
export type Placement = Map<string, { x: number; y: number; rotation: number }>

export const GRID = 20

/** Which side of the body a pin leaves from, in the part's own frame.
 *
 *  Pins on an edge are unambiguous. Pins INSIDE the outline are not: `gnd` sits
 *  at (0.5, 0.12) because its glyph hangs below the connection point, and the
 *  old `else → bottom` fallback sent its wire straight DOWN through the whole
 *  symbol. An interior pin leaves by its NEAREST edge, which is the only
 *  direction that reaches it without crossing the body. */
function pinSide(t: Pt): 'l' | 'r' | 't' | 'b' {
  if (t.x <= 0.05) return 'l'
  if (t.x >= 0.95) return 'r'
  if (t.y <= 0.05) return 't'
  if (t.y >= 0.95) return 'b'
  const d: [number, 'l' | 'r' | 't' | 'b'][] = [
    [t.x, 'l'], [1 - t.x, 'r'], [t.y, 't'], [1 - t.y, 'b'],
  ]
  return d.reduce((best, cur) => (cur[0] < best[0] ? cur : best))[1]
}

/** Pin offset from body centre, after rotation — the vector the wire leaves on. */
function pinOffset(o: SceneObject, t: Pt, rotation: number): Pt {
  const dx = (t.x - 0.5) * o.size.w
  const dy = (t.y - 0.5) * o.size.h
  const r = (rotation * Math.PI) / 180
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) }
}

/** Half-extent of a body once rotated (90/270 swap w and h). */
export function halfExtent(o: SceneObject, rotation: number): Pt {
  const swap = rotation === 90 || rotation === 270
  return { x: (swap ? o.size.h : o.size.w) / 2, y: (swap ? o.size.w : o.size.h) / 2 }
}

// ── Cost model ───────────────────────────────────────────────────────────────
// The two rules, stated as one number to minimise:
//
//   C = W_LEN·(wire length) + W_CROSS·(crossings) + W_PERIM·(perimeter)
//
// Clearance is NOT a term here. A penalty is a bribe — the optimiser will
// happily pay it to buy a shorter wire, and parts end up 4px apart. It is a
// hard constraint instead: a move that puts two bodies closer than CLEARANCE
// is rejected outright, so every layout the search can reach is already legal.
export const CLEARANCE = 20

// The search needs room to manoeuvre: packing every part at exactly CLEARANCE
// makes ~half of all candidate moves illegal, so the optimiser gets boxed into
// whichever basin it started in. Parts are searched at ROOMY spacing and only
// compacted toward CLEARANCE at the end, which keeps the hard floor while
// leaving the search somewhere to go.
//
// 28 is measured, not guessed — swept over the seven-circuit bench, it gave the
// shortest total wire (7744px) and fewest crossings (3). Tighter (20) boxes the
// search in; looser (44) lets parts drift and cost 30% more wire.
const ROOMY = 28

// Weights are swept over the seven-circuit bench, not guessed. Wire length is
// the unit (rule 1). A crossing costs 400px of trace: one crossing hurts a
// reader more than a long detour, and at this price the search will gladly
// route the long way round to remove one. Perimeter at 0.8 is the inward pull
// of rule 2 — measured against 0.15/0.35/1.6, it gave the tightest drawings
// (perimeter 6976 vs 7704, fill 0.48 vs 0.44) and the fewest crossings; above
// it, compactness starts outranking correctness and crossings triple.
const W_LEN = 1
const W_CROSS = 400
const W_PERIM = 0.8

// A net with no clean path around a body is worse than any crossing: it is a
// wire drawn THROUGH a component, which is simply wrong on a schematic. Priced
// above W_CROSS so the search sacrifices crossings and wire to avoid it.
const W_BLOCKED = 3000

// Straighter beats bent. A net whose two pins share an axis needs no corner at
// all, so it is charged nothing; one that must dog-leg pays a little. Swept at
// 0/25/60/150: 25 was best on every axis at once (fewest wires through bodies,
// shortest total wire, fewest crossings). Higher values buy straightness by
// pushing parts apart, which costs more than the bends save.
const W_BEND = 25

// Signal flow. A schematic reads left to right: sources and inputs at the left
// edge, each stage right of the one feeding it, outputs at the right. Nothing
// in wire length, crossings or perimeter expresses that — a mirrored layout
// scores identically — so a full adder could put its third INPUT in the middle
// of the gate array, downstream of gates it feeds, and still look "optimal".
// Charged per pixel a part sits left of where its rank says it belongs.
const W_FLOW = 3

// Tried and REJECTED: pulling supplies to the top of the sheet and grounds to
// the bottom, the vertical convention a textbook analog schematic follows.
// Measured over the bench it made things worse at every weight (1/2/4), and at
// 2 it also reintroduced wires through bodies: the pull stretches a circuit
// vertically faster than it organises it, and it fights W_BLOCKED for the same
// parts. The real fix for a cyclic analog circuit is a rail-aware placer that
// assigns nets to horizontal rails first, not a per-part attraction.

type Node = { id: string; w: number; h: number; rot: number; cx: number; cy: number; pins: Pt[] }

/** Pin world positions for a node at its current centre and rotation. */
function pinsAt(n: Node, obj: SceneObject): Pt[] {
  return n.pins.map((t) => {
    const o = pinOffset(obj, t, n.rot)
    return { x: n.cx + o.x, y: n.cy + o.y }
  })
}

/** Vertical clearance runs 5px wider than horizontal. Parts sit side by side in
 *  rows, so the gap above and below is where the horizontal wire lanes and a
 *  component's label have to fit; the same number on both axes leaves the rows
 *  visually tighter than the columns. */
const CLEARANCE_Y_EXTRA = 5

/** Do two axis-aligned boxes come closer than `gap` on either axis? */
function tooClose(a: Node, b: Node, gap: number): boolean {
  const ax = halfExtentWH(a), bx = halfExtentWH(b)
  return (
    Math.abs(a.cx - b.cx) < ax.x + bx.x + gap &&
    Math.abs(a.cy - b.cy) < ax.y + bx.y + gap + CLEARANCE_Y_EXTRA
  )
}

function halfExtentWH(n: Node): Pt {
  const swap = n.rot === 90 || n.rot === 270
  return { x: (swap ? n.h : n.w) / 2, y: (swap ? n.w : n.h) / 2 }
}

/** Does a segment's interior pass through a rectangle's interior? Liang-Barsky.
 *  Must handle ZERO-WIDTH segments: every wire here is orthogonal, so a naive
 *  "bounding boxes overlap on both axes" test can never fire and reports no
 *  violations at all — which is exactly how wires-through-bodies went unnoticed. */
function segInRect(a: Pt, b: Pt, r: { x1: number; y1: number; x2: number; y2: number }, eps = 1): boolean {
  const R = { x1: r.x1 + eps, y1: r.y1 + eps, x2: r.x2 - eps, y2: r.y2 - eps }
  if (R.x2 <= R.x1 || R.y2 <= R.y1) return false
  let t0 = 0, t1 = 1
  const dx = b.x - a.x, dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - R.x1, R.x2 - a.x, a.y - R.y1, R.y2 - a.y]
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return false; continue }
    const t = q[i] / p[i]
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t1 - t0 > 1e-6
}

/** Proper segment intersection — shared endpoints and touching don't count. */
function crosses(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-9) return false
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98
}

/**
 * Tier 1 — placement by simulated annealing on the cost function above.
 *
 * Force-directed layout was the wrong tool: it optimises a physics analogy
 * with no term for crossings and no term for compactness, so it SPREADS parts
 * (component area was 4–13% of the bounding box) and its spacing constant had
 * nothing to do with any clearance rule.
 *
 * This searches the cost directly. Moves are grid-aligned so pins stay on grid
 * lines for the router; each move is accepted if it lowers cost, or with
 * probability exp(-ΔC/T) if it raises it — the standard Metropolis rule, which
 * is what lets it climb out of the local minimum a greedy pass would sit in.
 *
 * Crossings are counted on straight pin-to-pin lines (the "ratsnest"), not on
 * routed paths: routing every candidate would be far too slow, and ratsnest
 * crossings are a good proxy — two nets that cross as straight lines almost
 * always still cross once routed.
 *
 * ponytail: O(n²) cost per move, fine to ~60 parts. Above that, bucket the
 * neighbour scan by grid cell.
 */
export function placeOptimized(
  ids: string[],
  edges: Edge[],
  getObj: (id: string) => SceneObject | undefined,
  origin: Pt,
): Placement {
  const n = ids.length
  const index = new Map(ids.map((id, i) => [id, i]))
  const objs = ids.map((id) => getObj(id))

  // Two-pin parts may rotate to face their neighbours; parts whose pins are
  // not a simple left/right pair (gnd, gates, a transistor) keep their
  // orientation, since rotating them scrambles a pinout a reader knows.
  const rotatable = ids.map((id, i) => {
    const o = objs[i]
    if (!o) return false
    const ts = terminalsOf(o)
    if (ts.length !== 2) return false
    const sides = new Set(ts.map(pinSide))
    return sides.has('l') && sides.has('r')
  })

  const nodes: Node[] = ids.map((id, i) => {
    const o = objs[i]
    return {
      id,
      w: o?.size.w ?? 96,
      h: o?.size.h ?? 48,
      rot: 0,
      cx: 0,
      cy: 0,
      pins: o ? terminalsOf(o) : [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
    }
  })

  // ── Seed: a compact grid, ordered by a BFS of the netlist ────────────────
  // Walking the graph puts connected parts in adjacent slots, so annealing
  // starts from something already near-sane instead of from noise.
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of edges) {
    if (e.fromId === e.toId) continue
    adj.get(e.fromId)?.push(e.toId)
    adj.get(e.toId)?.push(e.fromId)
  }
  const order: string[] = []
  const seen = new Set<string>()
  for (const start of ids) {
    if (seen.has(start)) continue
    seen.add(start)
    const q = [start]
    while (q.length) {
      const cur = q.shift()!
      order.push(cur)
      for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) (seen.add(nb), q.push(nb))
    }
  }

  // ── Logic rank: how far downstream each part sits ────────────────────────
  // Longest path from a source, which is the column a schematic draws it in.
  // Sources are parts nothing feeds — inputs, supplies — and outputs land at
  // the deepest rank. Computed on the DIRECTED edge list, since the direction
  // of connect(a.out, b.in) is exactly the signal direction.
  const rank = new Map<string, number>()
  {
    const indeg = new Map<string, number>(ids.map((id) => [id, 0]))
    const outs = new Map<string, string[]>(ids.map((id) => [id, []]))
    for (const e of edges) {
      if (e.fromId === e.toId || !indeg.has(e.fromId) || !indeg.has(e.toId)) continue
      outs.get(e.fromId)!.push(e.toId)
      indeg.set(e.toId, (indeg.get(e.toId) ?? 0) + 1)
    }
    const q = ids.filter((id) => (indeg.get(id) ?? 0) === 0)
    for (const id of ids) rank.set(id, 0)
    const queue = [...q]
    // Kahn's algorithm. A cycle (every loop circuit is one) simply leaves the
    // remaining parts at the rank they already have — a loop has no "flow"
    // direction to respect, which is the right answer for it.
    let guard = 0
    while (queue.length && guard++ < ids.length * 4) {
      const cur = queue.shift()!
      for (const nb of outs.get(cur) ?? []) {
        rank.set(nb, Math.max(rank.get(nb) ?? 0, (rank.get(cur) ?? 0) + 1))
        indeg.set(nb, (indeg.get(nb) ?? 1) - 1)
        if ((indeg.get(nb) ?? 0) === 0) queue.push(nb)
      }
    }
  }
  const maxRank = Math.max(1, ...[...rank.values()])

  // Flow only means something when the graph really is a left-to-right chain
  // AND the ranking actually reached every part. Kahn's algorithm stalls on a
  // cycle: a common-emitter amp has one source (the signal), so the queue
  // drains after two steps and every resistor, the ground and the output
  // coupling cap keep rank 0 — never visited, not genuinely upstream. With
  // maxRank still > 1 the flow term then believed itself and shoved all seven
  // into the leftmost column, which is exactly the pile-up it was meant to
  // prevent. Require that a clear majority got a real rank.
  const ranked = ids.filter((id) => (rank.get(id) ?? 0) > 0).length
  const hasFlow = maxRank > 1 && ranked >= Math.ceil(ids.length * 0.6)


  const maxW = Math.max(...nodes.map((x) => x.w), 96)
  const maxH = Math.max(...nodes.map((x) => x.h), 48)
  const stepX = Math.ceil((maxW + ROOMY) / GRID) * GRID
  const stepY = Math.ceil((maxH + ROOMY) / GRID) * GRID
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  order.forEach((id, k) => {
    const nd = nodes[index.get(id)!]
    nd.cx = origin.x + (k % cols) * stepX
    nd.cy = origin.y + Math.floor(k / cols) * stepY
  })

  // ── Cost ────────────────────────────────────────────────────────────────
  const pinCache: Pt[][] = nodes.map((nd, i) => pinsAt(nd, objs[i] ?? ({} as SceneObject)))
  const refreshPins = (i: number) => {
    const o = objs[i]
    if (o) pinCache[i] = pinsAt(nodes[i], o)
  }

  const edgeEnds = edges
    .map((e) => ({ a: index.get(e.fromId), b: index.get(e.toId), ai: e.fromIdx, bi: e.toIdx }))
    .filter((e): e is { a: number; b: number; ai: number; bi: number } =>
      e.a !== undefined && e.b !== undefined && e.a !== e.b)

  const endpoints = (e: { a: number; b: number; ai: number; bi: number }) => {
    const pa = pinCache[e.a]
    const pb = pinCache[e.b]
    return {
      p: pa[Math.min(e.ai, pa.length - 1)] ?? { x: nodes[e.a].cx, y: nodes[e.a].cy },
      q: pb[Math.min(e.bi, pb.length - 1)] ?? { x: nodes[e.b].cx, y: nodes[e.b].cy },
    }
  }

  const cost = (): number => {
    let len = 0
    const lines: { p: Pt; q: Pt; a: number; b: number }[] = []
    for (const e of edgeEnds) {
      const { p, q } = endpoints(e)
      len += Math.abs(p.x - q.x) + Math.abs(p.y - q.y) // Manhattan: wires are orthogonal
      lines.push({ p, q, a: e.a, b: e.b })
    }
    let cross = 0
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++)
        if (crosses(lines[i].p, lines[i].q, lines[j].p, lines[j].q)) cross++

    // Nets that cannot be drawn without crossing a body. The router can detour
    // around an obstacle in open space, but if a pin FACES AWAY from the part
    // it must reach, every path from it runs back across its own body — and no
    // router can fix that. It is a placement defect, so it is priced here.
    //
    // Each net is charged per obstructed elbow rather than only when both fail:
    // charging only the both-blocked case left the one-sided case free, which
    // is exactly how a diode ended up wired from its far side, its whole 93px
    // body spanned. Half weight when one elbow still works — the router will
    // find it — full weight when neither does.
    let blocked = 0
    for (const ln of lines) {
      const viaA = { x: ln.q.x, y: ln.p.y }
      const viaB = { x: ln.p.x, y: ln.q.y }
      let hitA = false, hitB = false
      // Every body counts, the net's own two endpoints included: a wire that
      // spans the component it connects to is exactly the defect being priced.
      for (let k = 0; k < n; k++) {
        const h = halfExtentWH(nodes[k])
        const r = { x1: nodes[k].cx - h.x, y1: nodes[k].cy - h.y, x2: nodes[k].cx + h.x, y2: nodes[k].cy + h.y }
        if (!hitA && (segInRect(ln.p, viaA, r) || segInRect(viaA, ln.q, r))) hitA = true
        if (!hitB && (segInRect(ln.p, viaB, r) || segInRect(viaB, ln.q, r))) hitB = true
        if (hitA && hitB) break
      }
      if (hitA && hitB) blocked += 1
      else if (hitA || hitB) blocked += 0.5

      // The straight run too. When a THIRD part sits squarely on the direct
      // line between two pins, both elbows can still look clear while every
      // real route has to cross it — which is how an ac-source ended up with a
      // resistor→bjt wire straight through it.
      let straight = false
      for (let k = 0; k < n && !straight; k++) {
        const h = halfExtentWH(nodes[k])
        const r = { x1: nodes[k].cx - h.x, y1: nodes[k].cy - h.y, x2: nodes[k].cx + h.x, y2: nodes[k].cy + h.y }
        if (segInRect(ln.p, ln.q, r)) straight = true
      }
      if (straight) blocked += 0.5
    }

    // Bends: a net needs none when its pins already line up. Counting the
    // ratsnest's own dog-leg is a faithful proxy — the router draws a straight
    // run for an aligned pair and an elbow otherwise.
    let bends = 0
    for (const ln of lines)
      if (Math.abs(ln.p.x - ln.q.x) > 0.5 && Math.abs(ln.p.y - ln.q.y) > 0.5) bends++

    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const nd of nodes) {
      const h = halfExtentWH(nd)
      x1 = Math.min(x1, nd.cx - h.x); x2 = Math.max(x2, nd.cx + h.x)
      y1 = Math.min(y1, nd.cy - h.y); y2 = Math.max(y2, nd.cy + h.y)
    }
    const perim = 2 * (x2 - x1 + (y2 - y1))

    // Flow: each part belongs in the column its logic rank names. Charged on
    // how far it sits from that column, so inputs stay at the left edge and
    // outputs at the right instead of being scattered through the gate array.
    let flow = 0
    if (hasFlow) {
      const span = Math.max(1, x2 - x1)
      for (const nd of nodes) {
        const want = x1 + (span * (rank.get(nd.id) ?? 0)) / maxRank
        flow += Math.abs(nd.cx - want)
      }
    }

    return W_LEN * len + W_CROSS * cross + W_BLOCKED * blocked + W_BEND * bends +
      W_FLOW * flow + W_PERIM * perim
  }

  /** Legal iff nothing is closer than `gap`. A hard constraint, never a cost
   *  term: a penalty is a bribe the optimiser will pay to buy a shorter wire,
   *  and parts end up touching. */
  const legalAt = (i: number, gap: number): boolean => {
    for (let j = 0; j < n; j++) if (j !== i && tooClose(nodes[i], nodes[j], gap)) return false
    return true
  }
  const legal = (i: number): boolean => legalAt(i, ROOMY)

  // ── Anneal ──────────────────────────────────────────────────────────────
  // Deterministic PRNG: the same script must always produce the same drawing,
  // or a lesson's figure changes between page loads.
  let seed = 0x2f6e2b1
  const rnd = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return ((seed >>> 0) % 100000) / 100000
  }
  const pick = (m: number) => Math.min(m - 1, Math.floor(rnd() * m))

  let cur = cost()
  // Each candidate costs O(n²) (crossings, blocked nets, clearance), so the
  // total is O(n²·ITERS) and a flat iteration count makes a big schematic
  // crawl — a 25-part chain took a full second. Scale the budget down as n
  // grows: large circuits get fewer, better-targeted moves rather than a
  // proportionally larger search nobody waits for.
  // ponytail: fine to ~60 parts. Beyond that, bucket the neighbour scans by
  // grid cell so each candidate is O(n) instead.
  const ITERS = Math.max(2000, Math.min(24000, Math.round(90000 / Math.max(1, n))))
  const T0 = Math.max(600, cur / Math.max(1, n))

  for (let step = 0; step < ITERS; step++) {
    const T = T0 * Math.pow(0.0006 / 1, step / ITERS) // geometric cooling to ~0
    const i = pick(n)
    const nd = nodes[i]
    const before = { cx: nd.cx, cy: nd.cy, rot: nd.rot }

    const roll = rnd()
    if (roll < 0.12 && rotatable[i]) {
      nd.rot = nd.rot === 0 ? 90 : 0
    } else if (roll < 0.28) {
      // Swap slots with another part — the move that escapes a bad ordering,
      // which no amount of nudging can undo.
      const j = pick(n)
      if (j === i) continue
      const oj = nodes[j]
      const tmp = { cx: oj.cx, cy: oj.cy }
      oj.cx = nd.cx; oj.cy = nd.cy
      nd.cx = tmp.cx; nd.cy = tmp.cy
      refreshPins(i); refreshPins(j)
      if (!legal(i) || !legal(j)) {
        nd.cx = before.cx; nd.cy = before.cy
        oj.cx = tmp.cx; oj.cy = tmp.cy
        refreshPins(i); refreshPins(j)
        continue
      }
      const next = cost()
      if (next <= cur || rnd() < Math.exp((cur - next) / Math.max(1e-6, T))) { cur = next; continue }
      nd.cx = before.cx; nd.cy = before.cy
      oj.cx = tmp.cx; oj.cy = tmp.cy
      refreshPins(i); refreshPins(j)
      continue
    } else {
      // Nudge along one axis by a few grid steps — the fine-tuning move.
      const mag = (1 + pick(3)) * GRID
      if (rnd() < 0.5) nd.cx += rnd() < 0.5 ? mag : -mag
      else nd.cy += rnd() < 0.5 ? mag : -mag
    }

    refreshPins(i)
    if (!legal(i)) {
      nd.cx = before.cx; nd.cy = before.cy; nd.rot = before.rot
      refreshPins(i)
      continue
    }
    const next = cost()
    if (next <= cur || rnd() < Math.exp((cur - next) / Math.max(1e-6, T))) {
      cur = next
    } else {
      nd.cx = before.cx; nd.cy = before.cy; nd.rot = before.rot
      refreshPins(i)
    }
  }

  // ── Compaction ──────────────────────────────────────────────────────────
  // Annealing runs at ROOMY spacing so it has room to search; compaction is
  // where rule 2 is paid off, sliding parts inward down to the CLEARANCE floor.
  //
  // A slide must still be judged by the COST, not merely by legality. Accepting
  // any legal move made ce_amp measurably worse — shorter on paper, but with
  // twice the crossings — because pulling one part inward drags its wires
  // across three others. The centroid is also recomputed every pass: held
  // fixed, it stops attracting anything once the layout has shrunk past it.
  for (let pass = 0; pass < 60; pass++) {
    let moved = false
    const tx = nodes.reduce((s, nd) => s + nd.cx, 0) / n
    const ty = nodes.reduce((s, nd) => s + nd.cy, 0) / n
    for (let i = 0; i < n; i++) {
      const nd = nodes[i]
      for (const axis of ['x', 'y'] as const) {
        const target = axis === 'x' ? tx : ty
        const cur0 = axis === 'x' ? nd.cx : nd.cy
        if (Math.abs(cur0 - target) < GRID) continue
        const dir = cur0 > target ? -GRID : GRID
        if (axis === 'x') nd.cx += dir
        else nd.cy += dir
        refreshPins(i)
        const next = legalAt(i, CLEARANCE) ? cost() : Infinity
        if (next <= cur) {
          cur = next
          moved = true
        } else {
          if (axis === 'x') nd.cx -= dir
          else nd.cy -= dir
          refreshPins(i)
        }
      }
    }
    if (!moved) break
  }

  // ── Emit ────────────────────────────────────────────────────────────────
  // Snap centres to the grid so pins land on grid lines for the router, then
  // convert back to the top-left position the scene stores.
  const out: Placement = new Map()
  for (let i = 0; i < n; i++) {
    const nd = nodes[i]
    const o = objs[i]
    out.set(nd.id, {
      x: Math.round(nd.cx / GRID) * GRID - (o?.size.w ?? 96) / 2,
      y: Math.round(nd.cy / GRID) * GRID - (o?.size.h ?? 48) / 2,
      rotation: nd.rot,
    })
  }
  return out
}

/**
 * Tier 2 — orthogonal routing.
 *
 * A* on a uniform grid, Manhattan moves only, with body cells blocked. A turn
 * costs extra so routes stay straight, and cells already used by another wire
 * cost a little so parallel runs share lanes instead of overlapping.
 */
export class OrthoRouter {
  private blocked = new Set<string>()
  private used = new Map<string, number>()

  /** Segments already drawn, so a new route can avoid lying ON one. Two wires
   *  sharing a stretch of lane render as a single line: the connection is
   *  invisible, and the sheet reads as if one of them were missing. */
  private drawn: [Pt, Pt][] = []

  /** How much of this polyline runs collinear with something already drawn. */
  overlapLength(pts: Pt[]): number {
    let total = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const horiz = Math.abs(a.y - b.y) < 0.5
      const vert = Math.abs(a.x - b.x) < 0.5
      if (!horiz && !vert) continue
      for (const [c, d] of this.drawn) {
        if (horiz && Math.abs(c.y - d.y) < 0.5 && Math.abs(c.y - a.y) < 0.5) {
          const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
          const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
          if (hi - lo > 1) total += hi - lo
        } else if (vert && Math.abs(c.x - d.x) < 0.5 && Math.abs(c.x - a.x) < 0.5) {
          const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
          const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
          if (hi - lo > 1) total += hi - lo
        }
      }
    }
    return total
  }

  /** Record a finished route so later ones can steer clear of its lanes. */
  commit(pts: Pt[]): void {
    for (let i = 1; i < pts.length; i++) this.drawn.push([pts[i - 1], pts[i]])
  }
  private lo: Pt
  private hi: Pt

  /** Exact body rectangles, kept so a finished polyline can be checked against
   *  real geometry rather than against the coarse grid it was searched on. */
  readonly rects: { x1: number; y1: number; x2: number; y2: number }[]

  constructor(obstacles: { x1: number; y1: number; x2: number; y2: number }[], bounds: { lo: Pt; hi: Pt }) {
    this.lo = bounds.lo
    this.hi = bounds.hi
    this.rects = obstacles.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 }))
    // The SEARCH grid is padded so routes keep a little air around a body;
    // `rects` above stays exact, because validating a pin stub against a padded
    // box would condemn every legitimate connection.
    const PAD = 8
    obstacles = obstacles.map((b) => ({ x1: b.x1 - PAD, y1: b.y1 - PAD, x2: b.x2 + PAD, y2: b.y2 + PAD }))
    // Round OUTWARD. Flooring the start and stopping at `<= x2` leaves the
    // last partial cell of a body unblocked, which is a gap a wire will find.
    for (const b of obstacles) {
      const x0 = Math.floor(b.x1 / GRID) * GRID
      const y0 = Math.floor(b.y1 / GRID) * GRID
      const x2 = Math.ceil(b.x2 / GRID) * GRID
      const y2 = Math.ceil(b.y2 / GRID) * GRID
      for (let x = x0; x <= x2; x += GRID) {
        for (let y = y0; y <= y2; y += GRID) {
          this.blocked.add(`${x},${y}`)
        }
      }
    }
  }

  private key(x: number, y: number) {
    return `${x},${y}`
  }

  /** Route from a to b. Both are snapped to the grid; the caller re-attaches
   *  the true pin coordinates at each end. Returns null if no path exists.
   *
   *  `escapes` are the few cells around each endpoint's own stub that stay
   *  passable. They are NOT whole bodies: exempting the endpoint components
   *  entirely — which is what this used to do — let A* route straight through
   *  the middle of a gate it merely connected to, because every cell of that
   *  gate was passable. A wire must stop at the pin on the boundary, so only
   *  the cells the stub itself occupies are opened. */
  route(a: Pt, b: Pt, escapes: Pt[] = []): Pt[] | null {
    const snap = (p: Pt) => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID })
    const s = snap(a)
    const t = snap(b)
    const open0 = new Set(escapes.map((p) => this.key(Math.round(p.x / GRID) * GRID, Math.round(p.y / GRID) * GRID)))
    open0.add(this.key(s.x, s.y))
    open0.add(this.key(t.x, t.y))

    const passable = (x: number, y: number) =>
      x >= this.lo.x && x <= this.hi.x && y >= this.lo.y && y <= this.hi.y &&
      (!this.blocked.has(this.key(x, y)) || open0.has(this.key(x, y)))

    const h = (x: number, y: number) => Math.abs(x - t.x) + Math.abs(y - t.y)
    const startKey = this.key(s.x, s.y)
    type Node = { x: number; y: number; g: number; f: number; dir: number; prev: string | null }
    const open = new Map<string, Node>()
    const closed = new Map<string, Node>()
    open.set(startKey, { x: s.x, y: s.y, g: 0, f: h(s.x, s.y), dir: -1, prev: null })

    const DIRS = [
      [GRID, 0],
      [-GRID, 0],
      [0, GRID],
      [0, -GRID],
    ]
    const LIMIT = 24000
    let steps = 0

    while (open.size > 0 && steps++ < LIMIT) {
      let bestKey: string | null = null
      let best: Node | null = null
      for (const [k, v] of open) if (!best || v.f < best.f) ((best = v), (bestKey = k))
      if (!best || !bestKey) break
      open.delete(bestKey)
      closed.set(bestKey, best)

      if (best.x === t.x && best.y === t.y) {
        // Reconstruct, keeping only corner points — a polyline, not every cell.
        const pts: Pt[] = []
        let cur: Node | undefined = best
        let curKey: string | null = bestKey
        while (cur && curKey) {
          pts.push({ x: cur.x, y: cur.y })
          const pk: string | null = cur.prev
          curKey = pk
          cur = pk ? closed.get(pk) : undefined
        }
        pts.reverse()
        for (const p of pts) this.used.set(this.key(p.x, p.y), (this.used.get(this.key(p.x, p.y)) ?? 0) + 1)
        return simplify(pts)
      }

      for (let d = 0; d < 4; d++) {
        const nx = best.x + DIRS[d][0]
        const ny = best.y + DIRS[d][1]
        const nk = this.key(nx, ny)
        if (closed.has(nk) || !passable(nx, ny)) continue
        const turn = best.dir !== -1 && best.dir !== d ? GRID * 3 : 0 // prefer straight runs
        const congestion = (this.used.get(nk) ?? 0) * GRID * 1.5 // prefer free lanes
        const g = best.g + GRID + turn + congestion
        const existing = open.get(nk)
        if (existing && existing.g <= g) continue
        open.set(nk, { x: nx, y: ny, g, f: g + h(nx, ny), dir: d, prev: bestKey })
      }
    }
    return null
  }
}

/** Drop collinear midpoints — keep only the corners. */
export function simplify(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const collinear =
      (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
      (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)
    if (!collinear) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/** The direction a pin's wire must leave in, in world space. */
export function pinExit(o: SceneObject, t: Pt): Pt {
  const side = pinSide(t)
  const base = side === 'l' ? { x: -1, y: 0 } : side === 'r' ? { x: 1, y: 0 } : side === 't' ? { x: 0, y: -1 } : { x: 0, y: 1 }
  const r = ((o.rotation ?? 0) * Math.PI) / 180
  const x = base.x * Math.cos(r) - base.y * Math.sin(r)
  const y = base.x * Math.sin(r) + base.y * Math.cos(r)
  return { x: Math.abs(x) < 1e-6 ? 0 : Math.sign(x), y: Math.abs(y) < 1e-6 ? 0 : Math.sign(y) }
}

/** Build the full orthogonal path for one edge, including pin stubs.
 *
 *  The stub runs straight out along the pin's own normal, so the only part of
 *  the path touching a body is that perpendicular exit. Everything past it is
 *  routed by A* over cells that exclude every body. */
export function routeEdge(
  router: OrthoRouter,
  objA: SceneObject,
  tA: Pt,
  objB: SceneObject,
  tB: Pt,
): Pt[] {
  const wA = terminalWorld(objA, tA)
  const wB = terminalWorld(objB, tB)
  const dA = pinExit(objA, tA)
  const dB = pinExit(objB, tB)

  // The stub must clear the component's own outline, not merely step one grid
  // unit. A pin on an edge needs almost nothing; a pin INSIDE the outline
  // (gnd, a transistor's collector) has to travel out past that edge first, or
  // every later leg starts inside the body and grazes it. Measure the real
  // distance to the exit edge and add a margin.
  const clearOf = (o: SceneObject, w: Pt, d: Pt) => {
    const h = halfExtent(o, o.rotation ?? 0)
    const cx = o.position.x + o.size.w / 2
    const cy = o.position.y + o.size.h / 2
    const depth = d.x !== 0
      ? (d.x > 0 ? cx + h.x - w.x : w.x - (cx - h.x))
      : (d.y > 0 ? cy + h.y - w.y : w.y - (cy - h.y))
    return Math.max(GRID, Math.ceil((depth + 6) / GRID) * GRID)
  }
  const offA = clearOf(objA, wA, dA)
  const offB = clearOf(objB, wB, dB)
  const sA = { x: wA.x + dA.x * offA, y: wA.y + dA.y * offA }
  const sB = { x: wB.x + dB.x * offB, y: wB.y + dB.y * offB }

  // Only the stub's own cells are opened — never the whole component.
  const escapes = [sA, sB, { x: wA.x + dA.x * GRID * 2, y: wA.y + dA.y * GRID * 2 },
                   { x: wB.x + dB.x * GRID * 2, y: wB.y + dB.y * GRID * 2 }]

  // Straight beats bent: a wire whose two stubs already line up needs no
  // corner at all. Try that, and the two L-shapes, before paying for A* —
  // they are the shortest AND the least bent paths that exist.
  const clean = (pts: Pt[]) => !hitsAnyBody(pts, router.rects, wA, wB)

  // Candidates are SCORED, not taken first-clean. A route that is legal can
  // still lie on top of a wire already drawn — two nets sharing a lane render
  // as one line, so a connection simply disappears from the sheet. Cheapest
  // wins on: overlap first, then bends, then length.
  const lengthOf = (pts: Pt[]) =>
    pts.slice(1).reduce((a, p, i) => a + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0)
  const bendsOf = (pts: Pt[]) => Math.max(0, simplify(pts).length - 2)
  // Overlap is not merely expensive, it is disqualifying: a wire hidden under
  // another is a connection the reader cannot see at all, which is worse than
  // any detour. The flat surcharge puts every overlapping candidate below
  // every clean one, so a clean route wins even when it is far longer.
  const score = (pts: Pt[]) => {
    const ov = router.overlapLength(pts)
    return (ov > 1 ? 100000 + ov * 40 : 0) + bendsOf(pts) * 30 + lengthOf(pts)
  }

  let bestPath: Pt[] | null = null
  let bestScore = Infinity
  const offer = (pts: Pt[]) => {
    if (!clean(pts)) return
    const sc = score(pts)
    if (sc < bestScore) { bestScore = sc; bestPath = pts }
  }

  // Aligned stubs join with no corner at all — but only when the straight run
  // between them is actually clear. Two parts stacked with their LEFT pins on
  // the same x have aligned stubs whose connecting line grazes both outlines,
  // so this is a candidate to be validated, never a shortcut to be assumed.
  const aligned =
    Math.abs(sA.x - sB.x) < 0.5 || Math.abs(sA.y - sB.y) < 0.5
      ? [wA, sA, sB, wB]
      : null
  if (aligned) offer(aligned)

  // Aligned but grazing (or already occupied): step the shared lane sideways
  // until it is both clear of bodies and clear of other wires.
  if (aligned) {
    const vertical = Math.abs(sA.x - sB.x) < 0.5
    for (let k = 1; k <= 10; k++) {
      for (const sgn of [1, -1]) {
        const off = sgn * k * GRID
        offer(vertical
          ? [wA, sA, { x: sA.x + off, y: sA.y }, { x: sA.x + off, y: sB.y }, sB, wB]
          : [wA, sA, { x: sA.x, y: sA.y + off }, { x: sB.x, y: sA.y + off }, sB, wB])
      }
    }
  }

  // Turn along the stub's own axis first, so the leg leaving a pin continues
  // straight out of the body instead of immediately cutting back across it.
  const elbows = dA.x !== 0
    ? [[wA, sA, { x: sB.x, y: sA.y }, sB, wB], [wA, sA, { x: sA.x, y: sB.y }, sB, wB]]
    : [[wA, sA, { x: sA.x, y: sB.y }, sB, wB], [wA, sA, { x: sB.x, y: sA.y }, sB, wB]]
  for (const e of elbows) offer(e)

  // Z-routes: leave both pins along their own normals, meet on a shared lane.
  // These are the shapes a human draws, and they clear an obstacle the plain
  // elbows cannot. Two bends, so they are tried before A*, which bends freely.
  const zs: Pt[][] = []
  for (let k = 1; k <= 14; k++) {
    const d = k * GRID
    if (dA.x !== 0 && dB.x !== 0) {
      for (const lane of [Math.max(sA.x, sB.x) + d, Math.min(sA.x, sB.x) - d, (sA.x + sB.x) / 2]) {
        zs.push([wA, sA, { x: lane, y: sA.y }, { x: lane, y: sB.y }, sB, wB])
      }
    } else if (dA.y !== 0 && dB.y !== 0) {
      for (const lane of [Math.max(sA.y, sB.y) + d, Math.min(sA.y, sB.y) - d, (sA.y + sB.y) / 2]) {
        zs.push([wA, sA, { x: sA.x, y: lane }, { x: sB.x, y: lane }, sB, wB])
      }
    } else {
      // Mixed orientation: run out from A, along, then into B's axis.
      const via = dA.x !== 0 ? { x: sB.x, y: sA.y } : { x: sA.x, y: sB.y }
      zs.push([wA, sA, via, sB, wB])
      const off = dA.x !== 0
        ? [{ x: sA.x + Math.sign(dA.x) * d, y: sA.y }, { x: sA.x + Math.sign(dA.x) * d, y: sB.y }]
        : [{ x: sA.x, y: sA.y + Math.sign(dA.y) * d }, { x: sB.x, y: sA.y + Math.sign(dA.y) * d }]
      zs.push([wA, sA, ...off, sB, wB])
    }
  }
  for (const z of zs) offer(z)
  if (bestPath) return simplify(bestPath)

  const mid = router.route(sA, sB, escapes)
  if (mid) {
    // The A* path runs between GRID CELLS, but a pin can sit off-grid (gate
    // inputs are at y = i/(n+1), so a 3-input gate's pins never land on a grid
    // line). Joining the stub straight to the first cell would cut a diagonal,
    // so bridge each end with an L that turns along the stub's own axis.
    const join = (stub: Pt, cell: Pt, d: Pt): Pt[] =>
      Math.abs(stub.x - cell.x) < 0.5 || Math.abs(stub.y - cell.y) < 0.5
        ? []
        : d.x !== 0
          ? [{ x: cell.x, y: stub.y }]
          : [{ x: stub.x, y: cell.y }]
    const head = join(sA, mid[0], dA)
    const tail = join(sB, mid[mid.length - 1], dB)
    const full = [wA, sA, ...head, ...mid, ...tail.reverse(), sB, wB]
    if (clean(full)) return simplify(full)
    // The jogs are what broke it — A*'s own cells are body-free by construction.
    const bare = [wA, sA, ...mid, sB, wB]
    if (clean(bare)) return simplify(bare)

    // The jog at one end crosses something. Re-enter the grid one cell further
    // along so the join has room to turn outside any body.
    for (let trim = 1; trim <= 3 && mid.length > trim * 2; trim++) {
      const inner = mid.slice(trim, mid.length - trim)
      if (inner.length < 2) break
      const h2 = join(sA, inner[0], dA)
      const t2 = join(sB, inner[inner.length - 1], dB)
      const cand = [wA, sA, ...h2, ...inner, ...t2.reverse(), sB, wB]
      if (clean(cand)) return simplify(cand)
    }
    return simplify(full)
  }

  // Nothing clean exists (a pin boxed in on all sides). Take the elbow that
  // turns along the stub's axis: at least it leaves the pin correctly.
  return simplify(elbows[0])
}

/** Route from an arbitrary POINT (a tap on an existing net) to a pin.
 *
 *  The junction end has no pin normal of its own — it is a branch off a wire
 *  already drawn — so only the destination gets a stub. Used for fan-out: the
 *  second connection leaving a pin taps its sibling instead of running its own
 *  long way round, which is what a junction dot means on a real schematic. */
export function routeEdgeFrom(
  router: OrthoRouter,
  from: Pt,
  objB: SceneObject,
  tB: Pt,
): Pt[] {
  const wB = terminalWorld(objB, tB)
  const dB = pinExit(objB, tB)
  const h = halfExtent(objB, objB.rotation ?? 0)
  const cx = objB.position.x + objB.size.w / 2
  const cy = objB.position.y + objB.size.h / 2
  const depth = dB.x !== 0
    ? (dB.x > 0 ? cx + h.x - wB.x : wB.x - (cx - h.x))
    : (dB.y > 0 ? cy + h.y - wB.y : wB.y - (cy - h.y))
  const off = Math.max(GRID, Math.ceil((depth + 6) / GRID) * GRID)
  const sB = { x: wB.x + dB.x * off, y: wB.y + dB.y * off }

  const clean = (pts: Pt[]) => !hitsAnyBody(pts, router.rects, from, wB)

  // Scored like routeEdge: a branch that lies along an existing wire is
  // invisible, so overlap outranks bends and length here too.
  const lengthOf = (pts: Pt[]) =>
    pts.slice(1).reduce((a, p, i) => a + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0)
  let best: Pt[] | null = null
  let bestScore = Infinity
  const offer = (pts: Pt[]) => {
    if (!clean(pts)) return
    const ov = router.overlapLength(pts)
    const sc = (ov > 1 ? 100000 + ov * 40 : 0) +
      Math.max(0, simplify(pts).length - 2) * 30 + lengthOf(pts)
    if (sc < bestScore) { bestScore = sc; best = pts }
  }

  if (Math.abs(from.x - sB.x) < 0.5 || Math.abs(from.y - sB.y) < 0.5) offer([from, sB, wB])
  const elbows = dB.x !== 0
    ? [[from, { x: from.x, y: sB.y }, sB, wB], [from, { x: sB.x, y: from.y }, sB, wB]]
    : [[from, { x: sB.x, y: from.y }, sB, wB], [from, { x: from.x, y: sB.y }, sB, wB]]
  for (const e of elbows) offer(e)

  const mid = router.route(from, sB, [sB])
  if (mid) offer([from, ...mid, sB, wB])
  if (best) return simplify(best)
  return simplify(elbows[0])
}

/** Does any leg of this polyline cut through a body?
 *
 *  Not every entry is a violation. Some symbols put their terminal INSIDE the
 *  outline — `gnd` sits at y=0.12, because the glyph hangs below its connection
 *  point — so a wire physically must enter that box to reach the pin. What must
 *  never happen is a wire TRAVERSING a body: crossing it, or running along it
 *  to reach something else.
 *
 *  The rule that separates the two: the leg touching a terminal may enter, but
 *  only straight along the pin's own normal and only as far as the pin. Every
 *  other leg must stay clear. */
export function hitsAnyBody(
  pts: Pt[],
  rects: { x1: number; y1: number; x2: number; y2: number }[],
  wA: Pt,
  wB: Pt,
): boolean {
  const terminalOf = (p: Pt): Pt | null =>
    Math.hypot(p.x - wA.x, p.y - wA.y) < 0.5 ? wA
      : Math.hypot(p.x - wB.x, p.y - wB.y) < 0.5 ? wB : null

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    for (const r of rects) {
      // Zero inset — the body's exact outline. Swept at -2/0/0.5/1.5: a
      // positive inset lets a wire slip along inside the border (6 wires
      // through bodies), while growing the box by 2px made every route detour
      // around neighbours it was merely passing, doubling crossings (22 vs 10)
      // and adding 45% more wire for no readability gain. Exactly 0 rejects
      // every genuine crossing and permits a wire to run flush alongside.
      if (!segInRect(a, b, r, 0)) continue

      // A leg that ENDS on one of this net's own terminals is that terminal's
      // approach. Some symbols place the pin INSIDE the outline (gnd sits at
      // y=0.12, the bjt's collector ~6px in), so reaching it necessarily
      // enters the box — but only just. The approach is legitimate exactly
      // while the part of it inside the body is no deeper than the pin itself,
      // measured from the edge it entered by. Anything deeper is traversal.
      //
      // The exemption belongs ONLY to the body that actually holds that
      // terminal. Applied to any rectangle it excuses a leg for crossing an
      // unrelated part it merely passes through — which let a resistor→bjt
      // wire run 48px straight through an ac-source purely because its far end
      // happened to sit on a pin.
      const term = terminalOf(a) ?? terminalOf(b)
      const ownsTerm = term !== null &&
        term.x >= r.x1 - 0.5 && term.x <= r.x2 + 0.5 &&
        term.y >= r.y1 - 0.5 && term.y <= r.y2 + 0.5
      if (term && ownsTerm) {
        const depth = Math.min(
          Math.abs(term.x - r.x1), Math.abs(r.x2 - term.x),
          Math.abs(term.y - r.y1), Math.abs(r.y2 - term.y),
        )
        if (insideRunLength(a, b, r) <= depth + 2) continue
      }
      return true
    }
  }
  return false
}

/** How much of this segment lies inside the rectangle. */
function insideRunLength(a: Pt, b: Pt, r: { x1: number; y1: number; x2: number; y2: number }): number {
  let t0 = 0, t1 = 1
  const dx = b.x - a.x, dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - r.x1, r.x2 - a.x, a.y - r.y1, r.y2 - a.y]
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return 0; continue }
    const t = q[i] / p[i]
    if (p[i] < 0) { if (t > t1) return 0; if (t > t0) t0 = t }
    else { if (t < t0) return 0; if (t < t1) t1 = t }
  }
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy)
}
