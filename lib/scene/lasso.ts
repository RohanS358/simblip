// Freeform lasso selection. The drawn path is treated as a CLOSED polygon
// whether or not the user got back to the start — the closing edge is
// implied, like every drawing app's lasso.
//
// "Inside" per object:
//   - anything with its own points (ink, polygons, lines): at least half of
//     its points fall inside. A handwritten word is circled loosely, so
//     requiring every point would miss strokes whose tails cross the loop.
//   - everything else: its centre is inside.
// Hits inside a group select the outermost group, same as clicking.

import type { SceneObject, Vec2 } from './types'
import { rootGroupOf, toWorld } from './group'

/** Even-odd ray cast; the polygon is implicitly closed. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function lassoHits(poly: Vec2[], objects: Record<string, SceneObject>): string[] {
  if (poly.length < 3) return []
  const out = new Set<string>()
  for (const o of Object.values(objects)) {
    if (o.geometry.kind === 'group' || o.metadata.hidden) continue
    const pts = o.geometry.points
    const hit = pts?.length
      ? pts.filter(([x, y]) => pointInPolygon(toWorld(o, x, y), poly)).length * 2 >= pts.length
      : pointInPolygon(toWorld(o, o.size.w / 2, o.size.h / 2), poly)
    if (hit) out.add(rootGroupOf(o.id, objects))
  }
  return [...out]
}
