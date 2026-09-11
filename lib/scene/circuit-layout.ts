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

/** Which side of the body a pin leaves from, in the part's own frame. */
function pinSide(t: Pt): 'l' | 'r' | 't' | 'b' {
  if (t.x <= 0.05) return 'l'
  if (t.x >= 0.95) return 'r'
  if (t.y <= 0.05) return 't'
  return 'b'
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

type Node = { id: string; w: number; h: number; rot: number; cx: number; cy: number; pins: Pt[] }

/** Pin world positions for a node at its current centre and rotation. */
function pinsAt(n: Node, obj: SceneObject): Pt[] {
  return n.pins.map((t) => {
    const o = pinOffset(obj, t, n.rot)
    return { x: n.cx + o.x, y: n.cy + o.y }
  })
}

/** Do two axis-aligned boxes come closer than `gap` on both axes? */
function tooClose(a: Node, b: Node, gap: number): boolean {
  const ax = halfExtentWH(a), bx = halfExtentWH(b)
  return (
    Math.abs(a.cx - b.cx) < ax.x + bx.x + gap &&
    Math.abs(a.cy - b.cy) < ax.y + bx.y + gap
  )
}

function halfExtentWH(n: Node): Pt {
  const swap = n.rot === 90 || n.rot === 270
  return { x: (swap ? n.h : n.w) / 2, y: (swap ? n.w : n.h) / 2 }
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
    const lines: { p: Pt; q: Pt }[] = []
    for (const e of edgeEnds) {
      const { p, q } = endpoints(e)
      len += Math.abs(p.x - q.x) + Math.abs(p.y - q.y) // Manhattan: wires are orthogonal
      lines.push({ p, q })
    }
    let cross = 0
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++)
        if (crosses(lines[i].p, lines[i].q, lines[j].p, lines[j].q)) cross++

    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const nd of nodes) {
      const h = halfExtentWH(nd)
      x1 = Math.min(x1, nd.cx - h.x); x2 = Math.max(x2, nd.cx + h.x)
      y1 = Math.min(y1, nd.cy - h.y); y2 = Math.max(y2, nd.cy + h.y)
    }
    const perim = 2 * (x2 - x1 + (y2 - y1))
    return W_LEN * len + W_CROSS * cross + W_PERIM * perim
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
  const ITERS = Math.min(24000, 1400 * Math.max(4, n))
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
  private lo: Pt
  private hi: Pt

  constructor(obstacles: { x1: number; y1: number; x2: number; y2: number }[], bounds: { lo: Pt; hi: Pt }) {
    this.lo = bounds.lo
    this.hi = bounds.hi
    for (const b of obstacles) {
      for (let x = Math.floor(b.x1 / GRID) * GRID; x <= b.x2; x += GRID) {
        for (let y = Math.floor(b.y1 / GRID) * GRID; y <= b.y2; y += GRID) {
          this.blocked.add(`${x},${y}`)
        }
      }
    }
  }

  private key(x: number, y: number) {
    return `${x},${y}`
  }

  /** Route from a to b. Both are snapped to the grid; the caller re-attaches
   *  the true pin coordinates at each end. Returns null if no path exists. */
  route(a: Pt, b: Pt, exempt: { x1: number; y1: number; x2: number; y2: number }[] = []): Pt[] | null {
    const snap = (p: Pt) => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID })
    const s = snap(a)
    const t = snap(b)
    const inExempt = (x: number, y: number) =>
      exempt.some((e) => x >= e.x1 - GRID && x <= e.x2 + GRID && y >= e.y1 - GRID && y <= e.y2 + GRID)

    const passable = (x: number, y: number) =>
      x >= this.lo.x && x <= this.hi.x && y >= this.lo.y && y <= this.hi.y &&
      (!this.blocked.has(this.key(x, y)) || inExempt(x, y))

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

/** Build the full orthogonal path for one edge, including pin stubs. */
export function routeEdge(
  router: OrthoRouter,
  objA: SceneObject,
  tA: Pt,
  objB: SceneObject,
  tB: Pt,
  exempt: { x1: number; y1: number; x2: number; y2: number }[],
): Pt[] {
  const wA = terminalWorld(objA, tA)
  const wB = terminalWorld(objB, tB)
  const dA = pinExit(objA, tA)
  const dB = pinExit(objB, tB)
  const STUB = GRID // leave the pin squarely before turning
  const sA = { x: wA.x + dA.x * STUB, y: wA.y + dA.y * STUB }
  const sB = { x: wB.x + dB.x * STUB, y: wB.y + dB.y * STUB }

  const mid = router.route(sA, sB, exempt)
  if (!mid) {
    // No orthogonal path — fall back to an L, still at right angles.
    return simplify([wA, sA, { x: sB.x, y: sA.y }, sB, wB])
  }

  // The A* path runs between GRID CELLS, but a pin can sit off-grid (gate
  // inputs are at y = i/(n+1), so a 3-input gate's pins never land on a grid
  // line). Joining the stub straight to the first cell would cut a diagonal,
  // so bridge each end with an L that turns along the stub's own axis.
  const joinStart = (stub: Pt, cell: Pt, d: Pt): Pt[] =>
    Math.abs(stub.x - cell.x) < 0.5 || Math.abs(stub.y - cell.y) < 0.5
      ? [] // already aligned — a straight run, no jog needed
      : d.x !== 0
        ? [{ x: cell.x, y: stub.y }] // left/right pin: run out, then turn
        : [{ x: stub.x, y: cell.y }] // top/bottom pin: run up/down, then turn

  const head = joinStart(sA, mid[0], dA)
  const tail = joinStart(sB, mid[mid.length - 1], dB)
  return simplify([wA, sA, ...head, ...mid, ...tail.reverse(), sB, wB])
}
