// Diagram animation, driven by the runtime clock.
//
// A diagram written with a timeline (`@1.5 client -> server : SYN`, see
// lib/scene/diagram.ts) stores that timeline as DATA on the objects it made:
//   connector.metadata.flow      = [{ at, dur, label? }, …]   tokens on this arrow
//   shape.metadata.flowLit       = [[from, to], …]            when this box glows
//   *.metadata.flowLoop          = restart period in seconds (0 = once)
// and carries a `flow` behavior whose `speed` and `loop` params the user can edit.
//
// Position is a PURE FUNCTION of the clock — so Pause freezes it, Reset clears
// it, the transport can scrub it, and an unplayed diagram costs nothing. This
// file holds the pure part (tested in flow.test.mjs) and the small DOM writer
// that the world's frame loop calls, exactly like syncCircuitDom.

import type { SceneObject } from '@/lib/scene/types'

export interface FlowToken { at: number; dur: number; label?: string }

/** Time within the timeline for clock `t`: sped up, and wrapped when it loops. */
export function timelineTime(t: number, speed: number, loop: number): number {
  const s = Math.max(0, t) * speed
  return loop > 0 ? s % loop : s
}

/** The token in flight at time `tm`, and how far along its arrow it is (0–1). */
export function activeToken(tokens: FlowToken[], tm: number): { token: FlowToken; u: number } | null {
  for (const tk of tokens) if (tm >= tk.at && tm < tk.at + tk.dur) return { token: tk, u: (tm - tk.at) / tk.dur }
  return null
}

export function isLit(windows: [number, number][], tm: number): boolean {
  return windows.some(([a, b]) => tm >= a && tm < b)
}

/** The point a fraction `u` of the way along a polyline (equal speed, not equal time per segment). */
export function pointAlong(pts: number[][], u: number): { x: number; y: number } {
  if (pts.length === 1) return { x: pts[0][0], y: pts[0][1] }
  const lens: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(l); total += l }
  let d = Math.min(1, Math.max(0, u)) * total
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : d / lens[i]
      return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f }
    }
    d -= lens[i]
  }
  return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }
}

const paramNum = (o: SceneObject, name: string, fallback: number) => {
  const b = o.behaviors.find((x) => x.enabled && x.type === 'flow')
  const p = b?.params[name]
  return p && p.kind === 'number' ? p.value : fallback
}

/** Write the current animation state into the DOM. Cheap: only objects that carry a flow behavior are touched. */
export function syncFlow(elements: Map<string, HTMLElement>, objects: Record<string, SceneObject>, t: number): void {
  for (const o of Object.values(objects)) {
    if (!o.behaviors.some((b) => b.enabled && b.type === 'flow')) continue
    const el = elements.get(o.id)
    if (!el) continue
    const speed = paramNum(o, 'speed', 1)
    const authored = Number(o.metadata.flowLoop ?? 0)
    const userLoop = paramNum(o, 'loop', 0)
    const tm = timelineTime(t, speed, userLoop > 0 ? userLoop : authored)
    const tokens = o.metadata.flow as FlowToken[] | undefined
    if (tokens) {
      const g = el.querySelector<SVGGElement>('[data-flow-token]')
      if (!g) continue
      const hit = activeToken(tokens, tm)
      if (!hit) { g.style.opacity = '0'; continue }
      const pts = o.geometry.points ?? [[0, 0], [o.size.w, 0]]
      const bends = (o.metadata.bends as number[][] | undefined) ?? []
      const path = [pts[0], ...bends, pts[pts.length - 1]]
      const p = pointAlong(path, hit.u)
      g.setAttribute('transform', `translate(${p.x} ${p.y})`)
      const text = g.querySelector('text')
      const label = hit.token.label ?? ''
      if (text && text.textContent !== label) {
        text.textContent = label
        const rect = g.querySelector('rect')
        const w = Math.max(16, label.length * 6.6 + 12)
        rect?.setAttribute('width', String(w)); rect?.setAttribute('x', String(-w / 2))
      }
      g.style.opacity = '1'
    }
    const windows = o.metadata.flowLit as [number, number][] | undefined
    if (windows) el.style.filter = isLit(windows, tm) ? 'drop-shadow(0 0 9px var(--accent-mint)) brightness(1.05)' : ''
  }
}

/** Undo everything syncFlow wrote (called when the run is reset). */
export function resetFlow(el: HTMLElement): void {
  el.style.filter = ''
  const g = el.querySelector<SVGGElement>('[data-flow-token]')
  if (g) g.style.opacity = '0'
}
