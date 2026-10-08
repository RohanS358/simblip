// Wire hops — the little "bridge" arc where one wire crosses another WITHOUT
// connecting to it (the schematic convention for "no junction here").
//
// Rule, so each crossing hops exactly once: the HORIZONTAL wire hops over the
// vertical one. A crossing is a junction (no hop) when either wire has an end
// on it — that is how the engine bonds wires (T-junctions, shared pins).

import type { SceneObject } from '@/lib/scene/types'
import { wirePolyline } from '@/lib/circuit/pin-wire'
import { connectorPoints } from '@/lib/render/connector-path'

type Pt = { x: number; y: number }
const R = 5 // hop radius, px
const JOIN = 3 // an end within this of a crossing makes it a junction

/** Local-space SVG path for wire `o` with hops over the other wires, or null when nothing crosses. */
export function hoppedPath(o: SceneObject, objects: Record<string, SceneObject>): string | null {
  const mine = wirePolyline(o)
  if (!mine) return null
  const others: Pt[][] = []
  const ends: Pt[] = [mine[0], mine[mine.length - 1]]
  for (const w of Object.values(objects)) {
    if (w.id === o.id) continue
    const p = wirePolyline(w)
    if (!p) continue
    others.push(p)
    ends.push(p[0], p[p.length - 1])
  }
  if (others.length === 0) return null

  const joined = (x: number, y: number) => ends.some((e) => Math.abs(e.x - x) <= JOIN && Math.abs(e.y - y) <= JOIN)
  const ox = o.position.x
  const oy = o.position.y
  let d = ''
  let any = false
  mine.forEach((a, i) => {
    if (i === 0) {
      d += `M${a.x - ox} ${a.y - oy}`
      return
    }
    const b = mine[i - 1]
    const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5
    if (!horizontal) {
      d += `L${a.x - ox} ${a.y - oy}`
      return
    }
    const y = a.y
    const dir = Math.sign(a.x - b.x)
    const xs: number[] = []
    for (const p of others) {
      for (let k = 1; k < p.length; k++) {
        const c = p[k - 1]
        const e = p[k]
        if (Math.abs(c.x - e.x) > 0.5) continue // only vertical crossers
        const x = c.x
        const lo = Math.min(c.y, e.y)
        const hi = Math.max(c.y, e.y)
        if (y <= lo + 0.5 || y >= hi - 0.5) continue
        const sLo = Math.min(a.x, b.x)
        const sHi = Math.max(a.x, b.x)
        if (x < sLo + R + 1 || x > sHi - R - 1) continue
        if (joined(x, y)) continue
        xs.push(x)
      }
    }
    xs.sort((m, n) => (m - n) * dir)
    let last = -Infinity
    for (const x of xs) {
      if (Math.abs(x - last) < 2 * R + 1) continue // two hops would collide
      last = x
      any = true
      // bump above the line: sweep flips with travel direction
      d += `L${x - dir * R - ox} ${y - oy}A${R} ${R} 0 0 ${dir > 0 ? 1 : 0} ${x + dir * R - ox} ${y - oy}`
    }
    d += `L${a.x - ox} ${a.y - oy}`
  })
  return any ? d : null
}

export { connectorPoints }
