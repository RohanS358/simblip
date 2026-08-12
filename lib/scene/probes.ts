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
 *  components, so their probes bind objects with no channel to choose. Controls
 *  (slider/button/trigger) hold a SINGLE target — one object plus one of its
 *  parameter names — spread over the targetType/targetObjectId/targetParamName
 *  trio the Inspector already edits. */
export type ProbeMode = 'channel' | 'object' | 'pair'

export interface ProbeSpec {
  /** The string param this probe reads and writes. For 'pair' probes this is
   *  the objectId param, and `nameParam`/`typeParam` carry the rest. */
  param: string
  label: string
  mode: ProbeMode
  /** 'pair' only: the param holding the chosen parameter name, and the param
   *  holding 'variable' | 'objectParam'. */
  nameParam?: string
  typeParam?: string
  /** Accent for the dot, arrow and chip. */
  color: string
  /** Is `target` a legal thing for this probe to point at? */
  accepts: (target: SceneObject) => boolean
  /** Hint shown while dragging when nothing valid is under the pointer. */
  rejectHint: string
}

const hasChannels = (o: SceneObject) => channelsFor(o).length > 0

/**
 * A control's single target/source slot ('source' → sourceObjectId +
 * sourceParamName + sourceType). Anything with a numeric parameter can be
 * driven or watched — getObjectParams always offers x/y/width/height/rotation
 * — so the only thing a control can't point at is a system object, which
 * snapTarget already skips.
 */
const controlProbe = (role: 'source' | 'target', label: string, color: string): ProbeSpec => ({
  param: `${role}ObjectId`,
  nameParam: `${role}ParamName`,
  typeParam: `${role}Type`,
  label,
  mode: 'pair',
  color,
  accepts: () => true,
  rejectHint: 'Drop on a component to drive one of its parameters',
})

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
  slider: [controlProbe('target', 'Drive', 'var(--chart-1)')],
  button: [controlProbe('target', 'Drive', 'var(--chart-1)')],
  trigger: [
    // Read first, then write — same left-to-right order as the trigger's own
    // "src condition threshold → target" summary line.
    controlProbe('source', 'Watch', 'var(--chart-2)'),
    controlProbe('target', 'Drive', 'var(--chart-1)'),
  ],
}

export const probesFor = (obj: SceneObject): ProbeSpec[] =>
  PROBE_SPECS[obj.geometry.kind] ?? []

// Geometry of the probe buttons in a component's header, so arrows can start
// exactly where the button is drawn. These mirror the Tailwind classes in
// components/objects/probe-buttons.tsx and the header rows that host it
// ("flex items-center gap-2 … px-3 py-1.5", buttons "h-4 w-4" first in the
// row). If either changes, change these with it.
/** Kinds whose chrome renders under CSS `zoom: componentScale` — mirrors
 *  COMPONENT_UI_KINDS in components/workspace/canvas.tsx for the kinds that
 *  can carry probes. */
const UI_SCALED = new Set(['graph', 'truthtable', 'chart', 'table', 'cashflow'])

/** The CSS zoom actually applied to `obj`'s chrome, given the user's
 *  component-scale preference. */
export const probeUiScale = (obj: SceneObject, componentScale: number): number =>
  UI_SCALED.has(obj.geometry.kind) ? componentScale : 1

const HEADER_PAD_X = 12 // px-3
const HEADER_PAD_Y = 6 // py-1.5
const PROBE_SIZE = 16 // h-4 w-4
const PROBE_GAP = 8 // gap-2

/** Controls (slider/button/trigger) have no header row to sit in, so their
 *  probes are pinned to the top-left corner by ProbeButtons' `float` variant.
 *  Mirrors the `left-1 top-1` inset there. */
const FLOAT_INSET = 4

/** Kinds whose probes float in the corner instead of sitting in a header row. */
export const FLOATING_PROBE_KINDS = new Set(['slider', 'button', 'trigger'])

/**
 * Centre of probe `i`'s button, in world coordinates — the point its arrow is
 * drawn from.
 *
 * Components in COMPONENT_UI_KINDS render their chrome under CSS `zoom`
 * (Properties → component scale), which scales the header's padding and the
 * buttons with it, so the offset has to be scaled the same way or the arrow
 * detaches from the button at any scale but 1.
 */
export function probeOrigin(obj: SceneObject, i: number, n: number, uiScale = 1): Vec2 {
  void n // buttons sit in a row; each one's offset depends only on its index
  const float = FLOATING_PROBE_KINDS.has(obj.geometry.kind)
  const padX = float ? FLOAT_INSET : HEADER_PAD_X
  const padY = float ? FLOAT_INSET : HEADER_PAD_Y
  const dx = padX + PROBE_SIZE / 2 + i * (PROBE_SIZE + PROBE_GAP)
  const dy = padY + PROBE_SIZE / 2
  const x = obj.position.x + dx * uiScale
  const y = obj.position.y + dy * uiScale
  if (!obj.rotation) return { x, y }
  // A rotated component rotates its header too, about the box's centre.
  const cx = obj.position.x + obj.size.w / 2
  const cy = obj.position.y + obj.size.h / 2
  const r = (obj.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return {
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }
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
  if (spec.mode === 'pair') {
    // Bound only when pointing at an OBJECT param — a control aimed at a page
    // variable has no object to draw an arrow to.
    if (getStr(obj, spec.typeParam!) !== 'objectParam' || !value) return []
    return [{ index: 0, objectId: value, channel: getStr(obj, spec.nameParam!) }]
  }
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

/** Serialize links back to the param's own encoding. Not used by 'pair'
 *  probes, which span three params — see writeProbeLinks. */
export function serializeLinks(spec: ProbeSpec, links: ProbeLink[]): string {
  if (spec.mode === 'object') return links.map((l) => l.objectId).join('; ')
  return serializeBindings(links.map((l): Binding => ({ objectId: l.objectId, channel: l.channel })))
}

/**
 * Write a probe's links back through `set`, whatever shape the probe stores
 * them in. One place so the canvas doesn't have to know that a control's
 * binding is three params while a graph's is one.
 */
export function writeProbeLinks(
  spec: ProbeSpec,
  links: ProbeLink[],
  set: (param: string, value: string) => void
): void {
  if (spec.mode !== 'pair') {
    set(spec.param, serializeLinks(spec, links))
    return
  }
  const link = links[0]
  // Clearing a control's target returns it to variable mode with no name,
  // which is exactly the unbound state the Inspector shows.
  set(spec.typeParam!, link ? 'objectParam' : 'variable')
  set(spec.param, link?.objectId ?? '')
  set(spec.nameParam!, link?.channel ?? '')
}

/** The parameter a fresh control binding should default to. Prefers a
 *  meaningful `value` (sliders, inputs, clocks) over the spatial fallbacks. */
export function defaultParamName(target: SceneObject, options: string[]): string {
  void target
  return options.find((p) => p === 'value') ?? options[0] ?? 'x'
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
/** How far the line runs straight out of the probe before it may turn. */
const LEAD_OUT = 18

/**
 * `lead` is the SIGNED distance the line must run straight out of the probe
 * before it may turn — negative to exit left, positive right, 0 for a plain
 * route with no exit stub (used by the free-drag preview).
 */
export function orthPath(a: Vec2, b: Vec2, lead: number = 0): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  // Nearly collinear AND heading the same way the probe exits: a single
  // straight run reads better than a degenerate elbow that doubles back.
  if (Math.abs(dy) < 1 && (lead === 0 || Math.sign(dx) === Math.sign(lead))) {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  }
  if (Math.abs(dx) < 1 && lead === 0) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`

  // The probe button sits inside the component's header, so the line has to
  // leave AWAY from the card before it may turn — otherwise it exits straight
  // across the component it belongs to.
  if (lead !== 0) {
    const exit = a.x + lead
    // Target is already past the exit stub in the same direction: one clean
    // turn at the stub, then run in.
    if (Math.sign(b.x - exit) === Math.sign(lead) || Math.abs(b.x - exit) < 1) {
      const midX = exit + (b.x - exit) / 2
      return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`
    }
    // Target is BEHIND the probe (the common case: graph on the left of what
    // it measures). Go out, run vertically clear of the component, then back
    // across at the target's row — a staple, never a line through the card.
    return `M ${a.x} ${a.y} L ${exit} ${a.y} L ${exit} ${b.y} L ${b.x} ${b.y}`
  }

  if (Math.abs(dx) < 24) return `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`
  const midX = a.x + dx / 2
  return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`
}

/**
 * Which way a probe's line should leave its component: -1 for left, +1 for
 * right. Probes live near the LEFT edge of the header, so they normally exit
 * left; a target far off to the right is better served by exiting right than
 * by wrapping the whole card.
 */
export function leadDirection(obj: SceneObject, origin: Vec2, target: Vec2): -1 | 1 {
  const right = obj.position.x + obj.size.w
  // Target clearly past the component's right edge → leaving right is shorter
  // and doesn't cross anything.
  if (target.x > right) return 1
  // Otherwise leave by the near (left) edge, which is where the probe sits.
  return origin.x - obj.position.x <= right - origin.x ? -1 : 1
}

/**
 * How far the stub must run to clear `obj`'s edge in direction `lead`, so the
 * turn happens OUTSIDE the component rather than on top of it. The probe sits
 * a little way inside the header, so a fixed lead alone isn't always enough.
 */
export function leadDistance(obj: SceneObject, origin: Vec2, lead: -1 | 1): number {
  const edge = lead < 0 ? obj.position.x : obj.position.x + obj.size.w
  return Math.max(LEAD_OUT, Math.abs(origin.x - edge) + LEAD_OUT)
}

/** Unit direction of the path's final segment — orients the arrowhead. */
export function endDirection(a: Vec2, b: Vec2, lead: number = 0): Vec2 {
  // Read the direction off the path itself rather than re-deriving the
  // branch logic — the two used to be maintained separately, which is exactly
  // how an arrowhead ends up pointing the wrong way after a routing change.
  const nums = orthPath(a, b, lead)
    .split(/[ML]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).map(Number))
  const last = nums[nums.length - 1]
  const prev = nums[nums.length - 2] ?? last
  const dx = last[0] - prev[0]
  const dy = last[1] - prev[1]
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x: 1, y: 0 }
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) || 1 }
}
