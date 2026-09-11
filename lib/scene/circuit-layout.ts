// Orthogonal schematic layout — force-directed placement, then TSM-style routing.
//
// Replaces four hand-written "place a common-emitter amp / a series loop /
// a digital chain" branches that each hardcoded coordinates for a circuit
// someone anticipated. Anything unanticipated fell through to a BFS-column
// pass that ignored pin orientation entirely, so a wire from a RIGHT pin to a
// component placed BELOW-LEFT doubled back across its own body.
//
// Two tiers, per the standard graph-drawing pipeline:
//   1. Placement — force-directed (Fruchterman-Reingold) on the PIN graph,
//      then snapped to a grid. Springs pull connected pins together; repulsion
//      spreads bodies. Pin offsets are part of the model, so a part rotates to
//      face its neighbours instead of being wired around.
//   2. Routing — orthogonal (Manhattan) A* on a coarse grid with obstacles,
//      so wires run at right angles, go AROUND bodies, and share lanes.
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

/**
 * Tier 1 — force-directed placement.
 *
 * Nodes repel (so bodies don't pile up); every edge is a spring between the
 * two PINS, not the two centres, which is what makes parts line up pin-to-pin
 * instead of merely near each other.
 */
export function placeForceDirected(
  ids: string[],
  edges: Edge[],
  getObj: (id: string) => SceneObject | undefined,
  origin: Pt,
): Placement {
  const n = ids.length
  const idx = new Map(ids.map((id, i) => [id, i]))

  // Seed on a circle: a deterministic, non-degenerate start. Starting all at
  // one point leaves repulsion with no direction to push in.
  const R = Math.max(160, n * 34)
  const pos = ids.map((_, i) => ({
    x: origin.x + R * Math.cos((2 * Math.PI * i) / n),
    y: origin.y + R * Math.sin((2 * Math.PI * i) / n),
  }))

  // Rotation is chosen after placement, but springs need a pin position now.
  // Use rotation 0 during the solve; the pass below re-derives it.
  const rot = ids.map(() => 0)

  const sizes = ids.map((id) => {
    const o = getObj(id)
    return { w: o?.size.w ?? 96, h: o?.size.h ?? 48 }
  })

  // Ideal spring length: a bit more than the widest part, so wires are visible.
  const K = Math.max(140, ...sizes.map((s) => Math.max(s.w, s.h))) + 40

  const ITER = 320
  for (let step = 0; step < ITER; step++) {
    const temp = K * 0.35 * (1 - step / ITER) // cooling — big moves early, fine at the end
    const disp = ids.map(() => ({ x: 0, y: 0 }))

    // Repulsion between every pair, scaled by body size so big parts clear more.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d = Math.hypot(dx, dy)
        if (d < 1e-3) {
          // Coincident: nudge deterministically rather than by random jitter,
          // so the same script always lays out the same way.
          dx = (i - j) || 1
          dy = 1
          d = Math.hypot(dx, dy)
        }
        const pad = (Math.max(sizes[i].w, sizes[i].h) + Math.max(sizes[j].w, sizes[j].h)) / 2
        const force = (K * K) / d + Math.max(0, pad + 30 - d) * 6 // hard shove when overlapping
        disp[i].x += (dx / d) * force
        disp[i].y += (dy / d) * force
        disp[j].x -= (dx / d) * force
        disp[j].y -= (dy / d) * force
      }
    }

    // Attraction along edges — between PINS, so orientation matters.
    for (const e of edges) {
      const a = idx.get(e.fromId)
      const b = idx.get(e.toId)
      if (a === undefined || b === undefined || a === b) continue
      const oa = getObj(e.fromId)
      const ob = getObj(e.toId)
      if (!oa || !ob) continue
      const ta = terminalsOf(oa)[e.fromIdx] ?? { x: 1, y: 0.5 }
      const tb = terminalsOf(ob)[e.toIdx] ?? { x: 0, y: 0.5 }
      const pa = pinOffset(oa, ta, rot[a])
      const pb = pinOffset(ob, tb, rot[b])
      const dx = pos[a].x + pa.x - (pos[b].x + pb.x)
      const dy = pos[a].y + pa.y - (pos[b].y + pb.y)
      const d = Math.max(1e-3, Math.hypot(dx, dy))
      const force = (d * d) / K
      disp[a].x -= (dx / d) * force
      disp[a].y -= (dy / d) * force
      disp[b].x += (dx / d) * force
      disp[b].y += (dy / d) * force
    }

    for (let i = 0; i < n; i++) {
      const d = Math.max(1e-3, Math.hypot(disp[i].x, disp[i].y))
      const lim = Math.min(d, temp)
      pos[i].x += (disp[i].x / d) * lim
      pos[i].y += (disp[i].y / d) * lim
    }
  }

  // ── Orientation ──────────────────────────────────────────────────────────
  // A 2-pin part points along the line between its neighbours: horizontal if
  // the run is mostly horizontal, vertical (rotated 90°) if mostly vertical.
  // That single rule is what stops the "wire leaves the right pin to reach a
  // part directly below" doubling-back the old layout produced everywhere.
  const nbrVec = new Map<string, Pt[]>()
  for (const e of edges) {
    const a = idx.get(e.fromId)
    const b = idx.get(e.toId)
    if (a === undefined || b === undefined || a === b) continue
    ;(nbrVec.get(e.fromId) ?? nbrVec.set(e.fromId, []).get(e.fromId)!).push({
      x: pos[b].x - pos[a].x,
      y: pos[b].y - pos[a].y,
    })
    ;(nbrVec.get(e.toId) ?? nbrVec.set(e.toId, []).get(e.toId)!).push({
      x: pos[a].x - pos[b].x,
      y: pos[a].y - pos[b].y,
    })
  }

  const out: Placement = new Map()
  for (let i = 0; i < n; i++) {
    const id = ids[i]
    const o = getObj(id)
    let rotation = 0
    if (o && terminalsOf(o).length === 2) {
      const sides = new Set(terminalsOf(o).map(pinSide))
      // Only re-orient parts whose pins are left/right in their own frame;
      // a part with top/bottom pins (gnd, a rail stub) already points the
      // right way and rotating it would be wrong.
      if (sides.has('l') && sides.has('r')) {
        const vs = nbrVec.get(id) ?? []
        const hx = vs.reduce((s, v) => s + Math.abs(v.x), 0)
        const hy = vs.reduce((s, v) => s + Math.abs(v.y), 0)
        if (hy > hx * 1.15) rotation = 90
      }
    }
    const half = halfExtent(o ?? ({ size: { w: 96, h: 48 } } as SceneObject), rotation)
    // Snap the CENTRE to the grid, then convert back to a top-left position,
    // so pins land on grid lines and routes meet them squarely.
    const cx = Math.round(pos[i].x / GRID) * GRID
    const cy = Math.round(pos[i].y / GRID) * GRID
    out.set(id, {
      x: cx - (o?.size.w ?? 96) / 2,
      y: cy - (o?.size.h ?? 48) / 2,
      rotation,
    })
    void half
  }

  // Separation pass — force-directed can still leave two bodies touching once
  // snapped. Push overlapping pairs apart along their centre line until clear.
  const centre = (id: string) => {
    const p = out.get(id)!
    const o = getObj(id)
    return { x: p.x + (o?.size.w ?? 96) / 2, y: p.y + (o?.size.h ?? 48) / 2 }
  }
  for (let pass = 0; pass < 24; pass++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const oi = getObj(ids[i])
        const oj = getObj(ids[j])
        if (!oi || !oj) continue
        const hi = halfExtent(oi, out.get(ids[i])!.rotation)
        const hj = halfExtent(oj, out.get(ids[j])!.rotation)
        const ci = centre(ids[i])
        const cj = centre(ids[j])
        const PAD = 34 // keep a routing lane between bodies
        const ox = hi.x + hj.x + PAD - Math.abs(ci.x - cj.x)
        const oy = hi.y + hj.y + PAD - Math.abs(ci.y - cj.y)
        if (ox <= 0 || oy <= 0) continue
        moved = true
        // Resolve along the shallower axis — the smaller correction.
        if (ox < oy) {
          const s = (ci.x < cj.x ? -1 : 1) * Math.ceil(ox / 2 / GRID) * GRID
          out.get(ids[i])!.x += s
          out.get(ids[j])!.x -= s
        } else {
          const s = (ci.y < cj.y ? -1 : 1) * Math.ceil(oy / 2 / GRID) * GRID
          out.get(ids[i])!.y += s
          out.get(ids[j])!.y -= s
        }
      }
    }
    if (!moved) break
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
