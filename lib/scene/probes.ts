'use client'

// Probes: the VISUAL side of value binding.
//
// A value-consuming component (graph, truth table…) carries one or more probe
// dots. Drag from a dot to any object and the arrow that lands there IS the
// binding — the same `series` / `inputs` / `outputs` params the Inspector
// edits, written through lib/scene/bindings.ts. There is no second source of
// truth: bind on canvas, see it in the Inspector, and vice versa.
//
// Nothing about the arrow is stored. Endpoints are recomputed from live object
// positions every render and the path is re-routed orthogonally, so arrows
// follow objects during Play (and while dragging) for free.

import type { SceneObject, Vec2 } from './types'
import { channelsFor, isDrivable, isReadable } from './channels'
import { nearestPointOnBoundary } from './connectors'
import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
import { parseBindings, serializeBindings, splitIds, type Binding } from './bindings'

/** What a probe accepts. Graphs read channels; truth tables drive/read whole
 *  components, so their probes bind objects with no channel to choose. */
export type ProbeMode = 'channel' | 'object'

export interface ProbeSpec {
  /** The string param this probe reads and writes. */
  param: string
  label: string
  mode: ProbeMode
  /** Accent for the dot, arrow and chip. */
  color: string
  /** Is `target` a legal thing for this probe to point at? */
  accepts: (target: SceneObject) => boolean
  /** Hint shown while dragging when nothing valid is under the pointer. */
  rejectHint: string
}

const hasChannels = (o: SceneObject) => channelsFor(o).length > 0

/** Probe layout per geometry kind. Add a kind here and it gets probes —
 *  the layer and the gesture are generic. */
export const PROBE_SPECS: Record<string, ProbeSpec[]> = {
  graph: [
    {
      param: 'series',
      label: 'Plot',
      mode: 'channel',
      color: 'var(--chart-1)',
      accepts: hasChannels,
      rejectHint: 'This component has no values to plot',
    },
  ],
  truthtable: [
    {
      param: 'inputs',
      label: 'In',
      mode: 'object',
      color: 'var(--chart-1)',
      accepts: isDrivable,
      rejectHint: 'Only a logic Input or Switch can drive a column',
    },
    {
      param: 'outputs',
      label: 'Out',
      mode: 'object',
      color: 'var(--chart-2)',
      accepts: isReadable,
      rejectHint: 'Only an Output, logic probe, LED or bulb can be read',
    },
  ],
}

export const probesFor = (obj: SceneObject): ProbeSpec[] =>
  PROBE_SPECS[obj.geometry.kind] ?? []

/** Where probe `i` of `n` sits — stacked down the component's left edge, just
 *  outside it so the dot never covers content. World coordinates. */
export function probeOrigin(obj: SceneObject, i: number, n: number): Vec2 {
  const gap = obj.size.h / (n + 1)
  return { x: obj.position.x, y: obj.position.y + gap * (i + 1) }
}

// ── What a probe is currently pointing at ───────────────────────────────────

export interface ProbeLink {
  /** Index within this probe's param — the Nth series / Nth column. */
  index: number
  objectId: string
  /** Empty for 'object' mode probes (truth-table columns have no channel). */
  channel: string
}

const getStr = (obj: SceneObject, name: string): string => {
  const p = obj.parameters[name]
  return p?.kind === 'string' ? p.value : ''
}

/** Read a probe's current links out of its param. */
export function probeLinks(obj: SceneObject, spec: ProbeSpec): ProbeLink[] {
  const value = getStr(obj, spec.param)
  if (spec.mode === 'object') {
    return splitIds(value).map((objectId, index) => ({ index, objectId, channel: '' }))
  }
  const bound = parseBindings(value)
  if (bound.length > 0) return bound.map((b, index) => ({ index, ...b }))

  // Legacy graphs stored one sourceId + a channel list. They still PLOT (see
  // parseSeries in components/objects/graph.tsx), so their probe has to show
  // arrows too — otherwise an old graph looks unbound while drawing data.
  // Editing one through a probe rewrites it into `series`, same as the
  // Inspector does.
  if (spec.param !== 'series') return []
  const sourceId = getStr(obj, 'sourceId')
  if (!sourceId) return []
  return getStr(obj, 'yChannels')
    .split(/[,;]/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((channel, index) => ({ index, objectId: sourceId, channel }))
}

/** Serialize links back to the param's own encoding. */
export function serializeLinks(spec: ProbeSpec, links: ProbeLink[]): string {
  if (spec.mode === 'object') return links.map((l) => l.objectId).join('; ')
  return serializeBindings(links.map((l): Binding => ({ objectId: l.objectId, channel: l.channel })))
}

/**
 * The channel a fresh connection should default to, so a drag produces a
 * useful plot without a second interaction. Prefers whatever the object is
 * "about" (a voltmeter's V, a body's x) over the first alphabetically, and
 * avoids re-picking a channel this probe already plots for that object.
 */
export function defaultChannel(target: SceneObject, taken: string[]): string {
  const options = channelsFor(target)
  const free = options.filter((c) => !taken.includes(c))
  return free[0] ?? options[0] ?? ''
}

// ── Snapping ────────────────────────────────────────────────────────────────

export interface SnapResult {
  target: SceneObject
  /** Where the arrowhead lands, in world coords. */
  point: Vec2
  /** True when the point is an electrical terminal rather than an outline. */
  terminal: boolean
  /** False when `target` is under the pointer but this probe can't use it —
   *  the layer shows it as rejected instead of snapping. */
  valid: boolean
}

/** Terminals win inside this screen-independent world radius. */
const TERMINAL_RADIUS = 26

/**
 * What the pointer is over: the nearest electrical terminal if one is close,
 * otherwise the nearest object whose boundary the pointer is near. Objects the
 * probe can't accept are still returned (valid:false) so the UI can say WHY
 * nothing happened rather than silently ignoring the drop.
 */
export function snapTarget(
  objects: SceneObject[],
  point: Vec2,
  spec: ProbeSpec,
  selfId: string
): SnapResult | null {
  let best: SnapResult | null = null
  let bestD = Infinity

  for (const o of objects) {
    if (o.id === selfId || o.metadata.render === 'system') continue

    // Electrical terminals are small and precise — they get priority over the
    // outline of the very same component, so wiring a graph to one pin of a
    // multi-pin part is possible.
    if (o.geometry.kind === 'symbol') {
      for (const t of terminalsOf(o)) {
        const p = terminalWorld(o, t)
        const d = Math.hypot(p.x - point.x, p.y - point.y)
        if (d < TERMINAL_RADIUS && d < bestD) {
          bestD = d
          best = { target: o, point: p, terminal: true, valid: spec.accepts(o) }
        }
      }
    }

    const near = nearestPointOnBoundary(o, point)
    if (!near) continue
    const inside =
      point.x >= o.position.x &&
      point.x <= o.position.x + o.size.w &&
      point.y >= o.position.y &&
      point.y <= o.position.y + o.size.h
    // Dropping anywhere inside a component counts as hitting it; outside, the
    // pointer has to be within a forgiving band of its edge.
    const d = inside ? 0 : Math.hypot(near.point.x - point.x, near.point.y - point.y)
    if (d < 36 && d < bestD) {
      bestD = d
      best = { target: o, point: near.point, terminal: false, valid: spec.accepts(o) }
    }
  }
  return best
}

/** Where an arrow should meet `target` when drawn from `from` — the point on
 *  its outline facing the probe, so the head sits on the edge, not the middle. */
export function attachPoint(target: SceneObject, from: Vec2): Vec2 {
  const near = nearestPointOnBoundary(target, from)
  if (near) return near.point
  return {
    x: target.position.x + target.size.w / 2,
    y: target.position.y + target.size.h / 2,
  }
}

// ── Orthogonal routing ──────────────────────────────────────────────────────

/**
 * An H/V-only path from `a` to `b`, like a routed schematic trace. The elbow
 * is placed on whichever axis has more room, which keeps the line off the
 * component it starts from. Pure geometry from two endpoints — nothing is
 * stored, so the route re-derives itself whenever either end moves.
 */
export function orthPath(a: Vec2, b: Vec2): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  // Nearly collinear: a single straight run reads better than a degenerate
  // elbow that doubles back on itself.
  if (Math.abs(dy) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  if (Math.abs(dx) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`

  // Probes exit horizontally (they sit on a left/right edge), so lead out on
  // X, turn once, and come in on X again — a Z. When the target is very close
  // horizontally, a simple L is tidier.
  if (Math.abs(dx) < 24) return `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`
  const midX = a.x + dx / 2
  return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`
}

/** Unit direction of the path's final segment — orients the arrowhead. */
export function endDirection(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) < 1) return { x: Math.sign(dx) || 1, y: 0 }
  if (Math.abs(dx) < 1) return { x: 0, y: Math.sign(dy) || 1 }
  // Both Z and L routes above finish on a horizontal run into the target.
  if (Math.abs(dx) < 24) return { x: Math.sign(dx) || 1, y: 0 }
  return { x: Math.sign(dx) || 1, y: 0 }
}
