// Pin-to-pin wiring helpers — pure functions, no store, no DOM.
//
// The wiring gesture (canvas.tsx) is: press a pin, drag, release on another pin
// (or anywhere on another part → its nearest free pin). The wire it makes is
// the same anchored connector the Shaper tool draws — terminal anchors, so it
// follows its parts when they move (lib/store/document.ts reprojectConnectors)
// — but routed with the schematic router, so it is orthogonal and goes AROUND
// bodies instead of through them.

import type { SceneObject } from '@/lib/scene/types'
import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
import { OrthoRouter, routeEdge, routeEdgeFrom, simplify, pinExit, halfExtent, type Pt } from '@/lib/scene/circuit-layout'

export interface PinHit {
  objectId: string
  idx: number
  point: Pt
}

const isPart = (o: SceneObject) => o.geometry.kind === 'symbol' && terminalsOf(o).length > 0

/** Nearest pin of any circuit part within `radius` of p. */
export function pinHit(objects: Record<string, SceneObject>, p: Pt, radius: number, skip?: PinHit): PinHit | null {
  let best: PinHit | null = null
  let bestD = radius
  for (const o of Object.values(objects)) {
    if (!isPart(o)) continue
    terminalsOf(o).forEach((t, idx) => {
      if (skip && skip.objectId === o.id && skip.idx === idx) return
      const w = terminalWorld(o, t)
      const d = Math.hypot(w.x - p.x, w.y - p.y)
      if (d < bestD) {
        bestD = d
        best = { objectId: o.id, idx, point: { x: w.x, y: w.y } }
      }
    })
  }
  return best
}

/** Every pin that already has a wire on it, as "objectId:idx". */
export function pinsInUse(objects: Record<string, SceneObject>): Set<string> {
  const used = new Set<string>()
  for (const o of Object.values(objects)) {
    if (o.metadata.render !== 'connector') continue
    for (const k of ['startAnchor', 'endAnchor'] as const) {
      const a = o.metadata[k] as { kind?: string; objectId?: string; terminalId?: string } | undefined
      if (a?.kind === 'terminal' && a.objectId) used.add(`${a.objectId}:${a.terminalId}`)
    }
  }
  return used
}

/** Released over a part's BODY (not on a pin): connect to its nearest pin,
 *  preferring one nothing is wired to yet. The autocomplete step — you aim at
 *  the part, the tool finds the pin. */
export function bodyTarget(objects: Record<string, SceneObject>, p: Pt, from: PinHit): PinHit | null {
  const used = pinsInUse(objects)
  let best: PinHit | null = null
  let bestScore = Infinity
  for (const o of Object.values(objects)) {
    if (!isPart(o) || o.id === from.objectId) continue
    const h = halfExtent(o, o.rotation ?? 0)
    const cx = o.position.x + o.size.w / 2
    const cy = o.position.y + o.size.h / 2
    if (Math.abs(p.x - cx) > h.x + 6 || Math.abs(p.y - cy) > h.y + 6) continue
    terminalsOf(o).forEach((t, idx) => {
      const w = terminalWorld(o, t)
      // Aim picks the part; the shortest wire from where you started picks the pin.
      const score =
        Math.hypot(w.x - p.x, w.y - p.y) + 0.6 * Math.hypot(w.x - from.point.x, w.y - from.point.y) + (used.has(`${o.id}:${idx}`) ? 1000 : 0)
      if (score < bestScore) {
        bestScore = score
        best = { objectId: o.id, idx, point: { x: w.x, y: w.y } }
      }
    })
  }
  return best
}

function routerFor(objects: Record<string, SceneObject>): OrthoRouter | null {
  const boxes = Object.values(objects)
    .filter((o) => o.geometry.kind === 'symbol')
    .map((o) => {
      const h = halfExtent(o, o.rotation ?? 0)
      const cx = o.position.x + o.size.w / 2
      const cy = o.position.y + o.size.h / 2
      return { x1: cx - h.x, y1: cy - h.y, x2: cx + h.x, y2: cy + h.y }
    })
  if (boxes.length === 0) return null
  const M = 320
  return new OrthoRouter(boxes, {
    lo: { x: Math.min(...boxes.map((b) => b.x1)) - M, y: Math.min(...boxes.map((b) => b.y1)) - M },
    hi: { x: Math.max(...boxes.map((b) => b.x2)) + M, y: Math.max(...boxes.map((b) => b.y2)) + M },
  })
}

/** Full orthogonal route between two pins, around every body. Pin end points are exact. */
export function routePins(objects: Record<string, SceneObject>, a: PinHit, b: PinHit): Pt[] {
  const oa = objects[a.objectId]
  const ob = objects[b.objectId]
  const router = routerFor(objects)
  if (!oa || !ob || !router) return [a.point, { x: b.point.x, y: a.point.y }, b.point]
  const ta = terminalsOf(oa)[a.idx]
  const tb = terminalsOf(ob)[b.idx]
  return simplify(routeEdge(router, oa, ta, ob, tb))
}

/** Live preview while the pointer is still in free space: leave the pin along
 *  its own normal, then one elbow to the cursor. Cheap enough for every move. */
export function routeLoose(objects: Record<string, SceneObject>, a: PinHit, tip: Pt): Pt[] {
  const o = objects[a.objectId]
  const t = o && terminalsOf(o)[a.idx]
  const d = o && t ? pinExit(o, { x: t.x, y: t.y }) : { x: 1, y: 0 }
  const STUB = 16
  const w = a.point
  const pts: Pt[] =
    d.x !== 0
      ? (() => {
          const x1 = d.x > 0 ? Math.max(w.x + STUB, tip.x) : Math.min(w.x - STUB, tip.x)
          return [w, { x: x1, y: w.y }, { x: x1, y: tip.y }, tip]
        })()
      : (() => {
          const y1 = d.y > 0 ? Math.max(w.y + STUB, tip.y) : Math.min(w.y - STUB, tip.y)
          return [w, { x: w.x, y: y1 }, { x: tip.x, y: y1 }, tip]
        })()
  return simplify(pts)
}

/** The wire already joining these two pins, if any (either direction). */
export function wireBetween(objects: Record<string, SceneObject>, a: PinHit, b: PinHit): string | null {
  const ka = `${a.objectId}:${a.idx}`
  const kb = `${b.objectId}:${b.idx}`
  for (const o of Object.values(objects)) {
    if (o.metadata.render !== 'connector') continue
    const s = o.metadata.startAnchor as { objectId?: string; terminalId?: string } | undefined
    const e = o.metadata.endAnchor as { objectId?: string; terminalId?: string } | undefined
    if (!s || !e) continue
    const x = `${s.objectId}:${s.terminalId}`
    const y = `${e.objectId}:${e.terminalId}`
    if ((x === ka && y === kb) || (x === kb && y === ka)) return o.id
  }
  return null
}

// ── Branching off a wire ─────────────────────────────────────────────────────
// A wire can START or END mid-run: that is a T-junction (the engine bonds a wire
// end that lands on another wire's body). The branch is a free end — connectors
// anchor to pins, not to other connectors — so it does not follow its parent if
// the parent is re-routed; the junction stays where you put it.

export interface WireHit {
  wireId: string
  point: Pt
  /** Orientation of the segment hit — a branch leaves perpendicular to it. */
  horizontal: boolean
}

/** World polyline of a drawn wire, or null if the object is not a wire. */
export function wirePolyline(o: SceneObject): Pt[] | null {
  if (o.geometry.kind !== 'line' && o.geometry.kind !== 'stroke') return null
  if (!o.behaviors.some((b) => b.enabled && b.type === 'wire')) return null
  const pts = o.geometry.points
  if (!pts || pts.length < 2) return null
  const at = (q: number[]): Pt => ({ x: o.position.x + q[0], y: o.position.y + q[1] })
  if (o.metadata.render === 'connector') {
    const bends = (o.metadata.bends as number[][] | undefined) ?? []
    const mid = bends.length > 0 ? bends : [[pts[pts.length - 1][0], pts[0][1]]]
    return [pts[0], ...mid, pts[pts.length - 1]].map(at)
  }
  return pts.map(at)
}

/** Nearest point on any drawn wire within `radius` of p. */
export function wireHit(objects: Record<string, SceneObject>, p: Pt, radius: number): WireHit | null {
  let best: WireHit | null = null
  let bestD = radius
  for (const o of Object.values(objects)) {
    const poly = wirePolyline(o)
    if (!poly) continue
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]
      const b = poly[i]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
      const q = { x: a.x + dx * t, y: a.y + dy * t }
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < bestD) {
        bestD = d
        best = { wireId: o.id, point: q, horizontal: Math.abs(dx) >= Math.abs(dy) }
      }
    }
  }
  return best
}

/** Branch preview in free space: leave perpendicular to the wire, one elbow to the cursor. */
export function routeFromWire(w: WireHit, tip: Pt): Pt[] {
  const p = w.point
  return simplify(w.horizontal ? [p, { x: p.x, y: tip.y }, tip] : [p, { x: tip.x, y: p.y }, tip])
}

/** Branch from a wire point to a pin, around bodies. */
export function routeWireToPin(objects: Record<string, SceneObject>, w: WireHit, b: PinHit): Pt[] {
  const ob = objects[b.objectId]
  const router = routerFor(objects)
  if (!ob || !router) return routeFromWire(w, b.point)
  return simplify(routeEdgeFrom(router, w.point, ob, terminalsOf(ob)[b.idx]))
}
