// lib/scene/connectors.ts
//
// Boundary snapping for the connector tool: a single continuous parameter
// `t` (0..1, clockwise from top-left) walks any object's outline, so a
// connector endpoint can snap to "the nearest point on this shape" without
// needing per-kind fixed connection points.

import type { SceneObject, Vec2 } from './types'

export type ConnectorAnchor =
  | { kind: 'boundary'; objectId: string; t: number }
  | { kind: 'terminal'; objectId: string; terminalId: string }

function bboxEdges(obj: SceneObject): { a: Vec2; b: Vec2; len: number }[] {
  const { x, y } = obj.position
  const { w, h } = obj.size
  const corners: Vec2[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  const edges: { a: Vec2; b: Vec2; len: number }[] = []
  for (let i = 0; i < 4; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    edges.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y) || 1 })
  }
  return edges
}

function ellipseParams(obj: SceneObject) {
  const { x, y } = obj.position
  const { w, h } = obj.size
  return { cx: x + w / 2, cy: y + h / 2, rx: w / 2 || 1, ry: h / 2 || 1 }
}

/** Nearest point on `obj`'s outline to `pt`, plus the boundary parameter
 *  `t` (0..1) that reproduces it via pointAtBoundaryT. Circles walk the
 *  ellipse angle; every other kind falls back to the bbox rectangle. */
export function nearestPointOnBoundary(
  obj: SceneObject,
  pt: Vec2
): { point: Vec2; t: number } | null {
  if (obj.geometry.kind === 'circle') {
    const { cx, cy, rx, ry } = ellipseParams(obj)
    const ang = Math.atan2((pt.y - cy) / ry, (pt.x - cx) / rx)
    const point = { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) }
    let t = (ang + Math.PI / 2) / (2 * Math.PI)
    if (t < 0) t += 1
    return { point, t }
  }
  const edges = bboxEdges(obj)
  const total = edges.reduce((s, e) => s + e.len, 0) || 1
  let best: { point: Vec2; t: number } | null = null
  let bestD = Infinity
  let cum = 0
  for (const e of edges) {
    const dx = e.b.x - e.a.x
    const dy = e.b.y - e.a.y
    const len2 = dx * dx + dy * dy || 1
    let s = ((pt.x - e.a.x) * dx + (pt.y - e.a.y) * dy) / len2
    s = Math.max(0, Math.min(1, s))
    const point = { x: e.a.x + s * dx, y: e.a.y + s * dy }
    const d = Math.hypot(point.x - pt.x, point.y - pt.y)
    if (d < bestD) {
      bestD = d
      best = { point, t: (cum + s * e.len) / total }
    }
    cum += e.len
  }
  return best
}

/** Inverse of nearestPointOnBoundary's `t`: world position at boundary
 *  parameter t (0..1) for the object's CURRENT position/size — used to
 *  reproject an anchored connector endpoint after the object moves. */
export function pointAtBoundaryT(obj: SceneObject, t: number): Vec2 {
  const tt = ((t % 1) + 1) % 1
  if (obj.geometry.kind === 'circle') {
    const { cx, cy, rx, ry } = ellipseParams(obj)
    const ang = tt * 2 * Math.PI - Math.PI / 2
    return { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) }
  }
  const edges = bboxEdges(obj)
  const total = edges.reduce((s, e) => s + e.len, 0) || 1
  let target = tt * total
  for (const e of edges) {
    if (target <= e.len || e === edges[edges.length - 1]) {
      const s = e.len ? target / e.len : 0
      return { x: e.a.x + s * (e.b.x - e.a.x), y: e.a.y + s * (e.b.y - e.a.y) }
    }
    target -= e.len
  }
  return edges[0].a
}
