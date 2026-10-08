// Universal eraser hit-test: what is under the eraser at page point p?
//
// Fine ink wins: if any stroke or line/wire passes within `radius` of p, those
// (and only those) are erased, so scribbling over a diagram clears the ink
// without taking the parts with it. Otherwise the TOPMOST object whose body
// contains p goes — shapes, parts, notes, text, tables, images, anything.
// Locked objects are never hit; a system boundary only answers on its border
// (its interior is the playground for everything inside it).

import type { SceneObject } from './types'
import { wirePolyline } from '@/lib/circuit/pin-wire'

type P = { x: number; y: number }

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function polyDist(p: P, pts: P[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y)
  let d = Infinity
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i]))
  return d
}

/** p in the object's own (unrotated) frame. */
function toLocal(o: SceneObject, p: P): P {
  if (!o.rotation) return p
  const cx = o.position.x + o.size.w / 2
  const cy = o.position.y + o.size.h / 2
  const r = (-o.rotation * Math.PI) / 180
  const dx = p.x - cx
  const dy = p.y - cy
  return { x: cx + dx * Math.cos(r) - dy * Math.sin(r), y: cy + dx * Math.sin(r) + dy * Math.cos(r) }
}

function inkPolyline(o: SceneObject): P[] | null {
  const wire = wirePolyline(o)
  if (wire) return wire
  const pts = o.geometry.points
  if (!pts || pts.length === 0) return null
  const c = { x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 }
  const r = ((o.rotation ?? 0) * Math.PI) / 180
  return pts.map(([x, y]) => {
    const dx = o.position.x + x - c.x
    const dy = o.position.y + y - c.y
    return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) }
  })
}

export function eraseTargets(objects: Record<string, SceneObject>, p: P, radius: number): string[] {
  const ink: string[] = []
  let top: SceneObject | null = null
  for (const o of Object.values(objects)) {
    if (o.metadata.locked || o.geometry.kind === 'group') continue
    const isInk = o.geometry.kind === 'stroke' || o.geometry.kind === 'line'
    if (isInk) {
      const poly = inkPolyline(o)
      const w = (o.metadata.strokeWidth as number | undefined) ?? 2
      if (poly && polyDist(p, poly) <= radius + w / 2) ink.push(o.id)
      continue
    }
    const q = toLocal(o, p)
    const m = radius
    const inside =
      q.x >= o.position.x - m && q.x <= o.position.x + o.size.w + m &&
      q.y >= o.position.y - m && q.y <= o.position.y + o.size.h + m
    if (!inside) continue
    if (o.metadata.render === 'system') {
      const B = 16
      const deep =
        q.x > o.position.x + B && q.x < o.position.x + o.size.w - B &&
        q.y > o.position.y + B && q.y < o.position.y + o.size.h - B
      if (deep) continue
    }
    if (!top || o.z >= top.z) top = o
  }
  if (ink.length > 0) return ink
  return top ? [top.id] : []
}
