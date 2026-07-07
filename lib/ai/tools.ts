// Turns the SAME component registry the palette reads from into an Ollama
// tool catalog — "every component is a tool", generated (not hand-copied) so
// it can never drift from what's actually placeable, matching this file's
// own stated design (docs' "the AI importer picks it up from the registry
// for free"). Each tool call mutates a DraftState of real SceneObjects, built
// from the exact factories a manual palette click uses — so AI output is
// byte-for-byte the thing a user could have placed by hand.

import { COMPONENTS, componentById, type ComponentDef } from '@/lib/scene/factory'
import { behaviorSpec } from '@/lib/behaviors/registry'
import { terminalsOf, terminalWorld, buildCircuit } from '@/lib/circuit/engine'
import { num, str, uid, type SceneObject, type ParamValue } from '@/lib/scene/types'
import type { AiObject, SimulationPayload } from './schema'

export interface OllamaFunctionTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string; items?: { type: string } }>
      required: string[]
    }
  }
}

// Pin glosses for polarized/asymmetric parts — copied verbatim from the
// comments already next to TERMINALS in lib/circuit/engine.ts (the real
// source of truth for pin order); this just surfaces them to the model.
const PIN_LABELS: Record<string, string> = {
  battery: '0=+, 1=−',
  'ac-source': '0=+, 1=−',
  'current-source': '0=+, 1=− (current flows − to + inside the source)',
  diode: '0=anode, 1=cathode',
  led: '0=anode, 1=cathode',
  zener: '0=anode, 1=cathode',
  bjt: '0=base, 1=collector, 2=emitter',
  'bjt-pnp': '0=base, 1=collector, 2=emitter',
  mosfet: '0=gate, 1=drain, 2=source',
  'mosfet-pmos': '0=gate, 1=drain, 2=source',
  opamp: '0=in+, 1=in−, 2=out',
  vcvs: '0=ctrl+, 1=ctrl−, 2=out+, 3=out−',
  vccs: '0=ctrl+, 1=ctrl−, 2=out+, 3=out−',
  ccvs: '0=ctrl+ (sensed current), 1=ctrl−, 2=out+, 3=out−',
  cccs: '0=ctrl+ (sensed current), 1=ctrl−, 2=out+, 3=out−',
  transformer: '0=primary+, 1=primary−, 2=secondary+, 3=secondary−',
  'transformer-ct': '0=primary+, 1=primary−, 2=secondary1, 3=center tap, 4=secondary2',
  'three-phase-source': '0=phase A, 1=phase B, 2=phase C, 3=neutral',
  wattmeter: '0=current coil+, 1=current coil−, 2=voltage coil+, 3=voltage coil−',
  potentiometer: '0=top, 1=wiper, 2=bottom',
  'dc-machine': '0=armature+, 1=armature−',
  'half-adder': '0=A, 1=B, 2=sum, 3=carry',
  'full-adder': '0=A, 1=B, 2=carry-in, 3=sum, 4=carry-out',
  'sr-latch': '0=S, 1=R, 2=Q',
  'jk-ff': '0=J, 1=CLK, 2=K, 3=Q',
  'd-ff': '0=D, 1=CLK, 2=Q',
  't-ff': '0=T, 1=CLK, 2=Q',
  mux: '0=in0, 1=in1, 2=sel, 3=out',
  decoder: '0=A(lsb), 1=B, 2..5=Y0..Y3',
  comparator: '0=A, 1=B, 2=A<B, 3=A=B, 4=A>B',
}

function sanitize(id: string): string {
  return 'place_' + id.replace(/[^a-zA-Z0-9]+/g, '_')
}

interface ParamInfo {
  name: string
  label: string
  default: string
}

/** Every numeric param this component exposes, whether it lives on the
 * object itself (symbols) or on one of its attached behaviors (everything
 * else) — read straight off a freshly-instantiated copy, so it's always
 * exactly what the Inspector would show. */
function paramsForComponent(def: ComponentDef): ParamInfo[] {
  const obj = def.create({ x: 0, y: 0 })
  const out: ParamInfo[] = []
  const seen = new Set<string>()
  for (const [name, p] of Object.entries(obj.parameters)) {
    if (p.kind !== 'number' || seen.has(name)) continue
    seen.add(name)
    out.push({ name, label: name, default: p.expr })
  }
  for (const b of obj.behaviors) {
    for (const ps of behaviorSpec(b.type)?.params ?? []) {
      if (seen.has(ps.name)) continue
      seen.add(ps.name)
      out.push({ name: ps.name, label: ps.label, default: ps.default })
    }
  }
  return out
}

function describeComponent(def: ComponentDef): string {
  const obj = def.create({ x: 0, y: 0 })
  const hints = [...new Set(obj.behaviors.map((b) => behaviorSpec(b.type)?.hint).filter((h): h is string => Boolean(h)))]
  const pins = PIN_LABELS[def.id]
  let desc = `${def.label} (${def.domain}).`
  if (hints.length > 0) desc += ' ' + hints.join(' ')
  if (pins) desc += ` Terminals: ${pins}.`
  return desc
}

interface ComponentToolEntry {
  toolName: string
  componentId: string
  tool: OllamaFunctionTool
}

/** Connectors (spring/rod/rope/damper, lenses/mirrors, wave boundaries…) are
 * a 'line' with two independent endpoints, not a box — asking the model for
 * a rotation angle to redirect a fixed-length default segment is unreliable.
 * Give these dx2/dy2 (the second endpoint, same shared coordinate frame)
 * instead, matching exactly how a user drags them into place point-to-point
 * (canvas.tsx's CONNECTOR_IDS placeLine gesture). */
function isConnector(def: ComponentDef): boolean {
  return def.create({ x: 0, y: 0 }).geometry.kind === 'line'
}

// Kept terse deliberately: this block of text repeats once per param per
// tool across ~85 tools, so shaving words here is the single biggest lever
// on prompt size (and therefore per-request latency) the catalog has. The
// one-time meaning (numbers can be expressions referencing a page variable)
// is explained once in the system prompt instead of repeated per param.
export const COMPONENT_TOOLS: ComponentToolEntry[] = COMPONENTS.map((def) => {
  const params = paramsForComponent(def)
  const connector = isConnector(def)
  const properties: OllamaFunctionTool['function']['parameters']['properties'] = {
    dx: { type: 'number', description: connector ? 'X, endpoint 1 (px)' : 'X, top-left (px)' },
    dy: { type: 'number', description: connector ? 'Y, endpoint 1 (px)' : 'Y, top-left (px)' },
    name: { type: 'string', description: 'label' },
  }
  if (connector) {
    properties.dx2 = { type: 'number', description: 'X, endpoint 2 (px)' }
    properties.dy2 = { type: 'number', description: 'Y, endpoint 2 (px)' }
  } else {
    properties.rotation = { type: 'number', description: 'degrees' }
  }
  for (const p of params) {
    properties[p.name] = { type: 'string', description: `${p.label} (default ${p.default})` }
  }
  return {
    toolName: sanitize(def.id),
    componentId: def.id,
    tool: {
      type: 'function',
      function: {
        name: sanitize(def.id),
        description: describeComponent(def),
        parameters: { type: 'object', properties, required: connector ? ['dx', 'dy', 'dx2', 'dy2'] : ['dx', 'dy'] },
      },
    },
  }
})

const toolNameToComponentId = new Map(COMPONENT_TOOLS.map((t) => [t.toolName, t.componentId]))

export const STRUCTURAL_TOOLS: OllamaFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'add_variable',
      description:
        'Add a page-level formula variable (e.g. g=9.81, k=30) that component parameters can reference by name instead of a literal number.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'variable name, e.g. "g"' },
          expr: { type: 'string', description: 'numeric expression, e.g. "9.81"' },
        },
        required: ['name', 'expr'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connect',
      description:
        'Wire two terminals together (electrical/electronics/digital parts only) — snaps a wire exactly onto both pins so the circuit solver sees a real connection. Use the placed_index and pin index returned when each part was placed.',
      parameters: {
        type: 'object',
        properties: {
          fromIndex: { type: 'number', description: 'placed_index of the first part' },
          fromPin: { type: 'number', description: 'terminal/pin index on the first part' },
          toIndex: { type: 'number', description: 'placed_index of the second part' },
          toPin: { type: 'number', description: 'terminal/pin index on the second part' },
        },
        required: ['fromIndex', 'fromPin', 'toIndex', 'toPin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attach',
      description:
        'Snap one end of an already-placed connector (spring/rod/rope/damper/lens/etc.) exactly onto the center of another already-placed part, so they actually touch and the physics constraint is real. Use this instead of guessing coordinates — after placing a spring/rod and its two anchor parts, call this once per end.',
      parameters: {
        type: 'object',
        properties: {
          connectorIndex: { type: 'number', description: 'placed_index of the connector (spring/rod/rope/damper…)' },
          end: { type: 'string', description: '"a" = its first endpoint (dx,dy when placed), "b" = its second endpoint (dx2,dy2 when placed)' },
          targetIndex: { type: 'number', description: 'placed_index of the part to snap this end onto (its center)' },
        },
        required: ['connectorIndex', 'end', 'targetIndex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_graph',
      description:
        'Add a live graph that plots channels from a previously placed object once Play is pressed. Always add one of these for any quantity the question asks you to plot or observe over time.',
      parameters: {
        type: 'object',
        properties: {
          dx: { type: 'number' },
          dy: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          sourceIndex: { type: 'number', description: 'placed_index of the object to read from' },
          channels: {
            type: 'array',
            items: { type: 'string' },
            description:
              'channel names for that object\'s domain, e.g. ["y","vy"] mechanics, ["V","I","P"] circuits/machines, ["temp"] thermal, ["x","angle","omega"] rotational',
          },
        },
        required: ['dx', 'dy', 'sourceIndex', 'channels'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Add a sticky note with explanatory text.',
      parameters: {
        type: 'object',
        properties: { dx: { type: 'number' }, dy: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, text: { type: 'string' } },
        required: ['dx', 'dy', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_formula',
      description: 'Add a rendered LaTeX formula annotation.',
      parameters: {
        type: 'object',
        properties: { dx: { type: 'number' }, dy: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, latex: { type: 'string' } },
        required: ['dx', 'dy', 'latex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description:
        'Call this exactly once, when the simulation is fully built, with a short user-facing summary — what it demonstrates and what to change or press.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    },
  },
]

export const ALL_TOOLS: OllamaFunctionTool[] = [...COMPONENT_TOOLS.map((t) => t.tool), ...STRUCTURAL_TOOLS]

// ── Execution ────────────────────────────────────────────────────────────

export interface DraftState {
  variables: { name: string; expr: string }[]
  objects: SceneObject[]
}

export function createDraft(): DraftState {
  return { variables: [], objects: [] }
}

export interface ToolResult {
  ok: boolean
  error?: string
  placed_index?: number
  name?: string
  terminals?: { pin: number; x: number; y: number }[]
}

function bareObject(kind: 'graph' | 'note' | 'formula', name: string, args: Record<string, unknown>): SceneObject {
  return {
    id: uid(),
    name,
    geometry: { kind },
    position: { x: Number(args.dx) || 0, y: Number(args.dy) || 0 },
    size: {
      w: Number(args.w) || (kind === 'note' ? 220 : kind === 'formula' ? 300 : 420),
      h: Number(args.h) || (kind === 'note' ? 160 : kind === 'formula' ? 90 : 280),
    },
    rotation: 0,
    z: Date.now() % 1_000_000,
    behaviors: [],
    parameters: {},
    metadata: {},
  }
}

/** Execute one tool call against the draft. Never throws — a bad call from
 * the model becomes `{ok:false, error}` fed back as the tool result so it
 * can self-correct, the same way a real tool-use loop should degrade. */
export function runTool(draft: DraftState, toolName: string, args: Record<string, unknown>): ToolResult {
  try {
    if (toolName === 'add_variable') {
      const name = String(args.name ?? '').trim()
      if (!name) return { ok: false, error: 'name is required' }
      if (draft.variables.some((v) => v.name === name)) {
        return { ok: false, error: `Variable "${name}" already exists — reuse it by name instead of adding it again.` }
      }
      draft.variables.push({ name, expr: String(args.expr ?? '0') })
      return { ok: true }
    }

    if (toolName === 'connect') {
      const fromIndex = Number(args.fromIndex)
      const toIndex = Number(args.toIndex)
      const fromPin = Number(args.fromPin)
      const toPin = Number(args.toPin)
      const a = draft.objects[fromIndex]
      const b = draft.objects[toIndex]
      if (!a || !b) return { ok: false, error: 'fromIndex/toIndex out of range — place both parts first' }
      const ta = terminalsOf(a)
      const tb = terminalsOf(b)
      const pa = ta[fromPin]
      const pb = tb[toPin]
      if (!pa || !pb) return { ok: false, error: `pin out of range (part has ${ta.length || tb.length} terminals)` }

      // Same failure shape as duplicate place_* calls: calling connect again
      // for a pin pair that's already wired always "succeeds" and adds
      // another redundant wire — nothing stopped the model from spamming
      // connect() on the same two pins instead of finding the ONE actually
      // missing wire when a completeness check rejected finish.
      const pinKey = [`${fromIndex}:${fromPin}`, `${toIndex}:${toPin}`].sort().join('|')
      const dupWireIndex = draft.objects.findIndex((o) => o.metadata.__aiPinKey === pinKey)
      if (dupWireIndex !== -1) {
        return { ok: false, error: `Pin ${fromPin} of index ${fromIndex} and pin ${toPin} of index ${toIndex} are already wired together (placed_index ${dupWireIndex}) — that's not the missing connection.` }
      }

      const wa = terminalWorld(a, pa)
      const wb = terminalWorld(b, pb)
      const wire: SceneObject = {
        id: uid(),
        name: 'Wire',
        geometry: { kind: 'line', points: [[0, 0], [wb.x - wa.x, wb.y - wa.y]] },
        position: { x: wa.x, y: wa.y },
        size: { w: Math.max(2, Math.abs(wb.x - wa.x)), h: Math.max(2, Math.abs(wb.y - wa.y)) },
        rotation: 0,
        z: Date.now() % 1_000_000,
        behaviors: [{ id: uid(), type: 'wire', enabled: true, params: {} }],
        parameters: {},
        metadata: { __aiPinKey: pinKey },
      }
      draft.objects.push(wire)
      return { ok: true, placed_index: draft.objects.length - 1 }
    }

    if (toolName === 'attach') {
      const conn = draft.objects[Number(args.connectorIndex)]
      const target = draft.objects[Number(args.targetIndex)]
      if (!conn || !target) return { ok: false, error: 'connectorIndex/targetIndex out of range — place both parts first' }
      const pts = conn.geometry.points
      if (conn.geometry.kind !== 'line' || !pts || pts.length < 2) {
        return {
          ok: false,
          error:
            'connectorIndex must be a spring/rod/rope/damper (a line-based connector) — never call attach for two solid bodies (beam/block/ground/wheel/etc.). Solid bodies just need to be POSITIONED so they touch (accounting for rotation); gravity/collision does the rest once Play is pressed. Do not retry attach for this pair — reposition the bodies instead.',
        }
      }
      const absA = { x: conn.position.x + pts[0][0], y: conn.position.y + pts[0][1] }
      const absB = { x: conn.position.x + pts[pts.length - 1][0], y: conn.position.y + pts[pts.length - 1][1] }
      const targetCenter = { x: target.position.x + target.size.w / 2, y: target.position.y + target.size.h / 2 }
      const end = String(args.end).toLowerCase() === 'b' ? 1 : 0
      const newA = end === 0 ? targetCenter : absA
      const newB = end === 1 ? targetCenter : absB
      conn.position = { x: newA.x, y: newA.y }
      conn.geometry.points = [[0, 0], [newB.x - newA.x, newB.y - newA.y]]
      conn.size = { w: Math.max(2, Math.abs(newB.x - newA.x)), h: Math.max(2, Math.abs(newB.y - newA.y)) }
      return { ok: true }
    }

    if (toolName === 'add_graph') {
      const src = draft.objects[Number(args.sourceIndex)]
      if (!src) return { ok: false, error: 'sourceIndex out of range — place the object first' }
      const channels = Array.isArray(args.channels) ? args.channels.map(String) : []
      const channelKey = channels.join(',')
      const dupGraphIndex = draft.objects.findIndex(
        (o) => o.geometry.kind === 'graph' && exprOf(o.parameters.sourceId) === src.id && exprOf(o.parameters.yChannels) === channelKey
      )
      if (dupGraphIndex !== -1) {
        return { ok: false, error: `A graph already plots ${channelKey || 'that'} from this object (placed_index ${dupGraphIndex}) — no need to add another.` }
      }
      const obj = bareObject('graph', 'Graph', args)
      obj.parameters.sourceId = str(src.id)
      obj.parameters.yChannels = str(channelKey)
      draft.objects.push(obj)
      return { ok: true, placed_index: draft.objects.length - 1 }
    }

    if (toolName === 'add_note' || toolName === 'add_formula') {
      const kind = toolName === 'add_note' ? 'note' : 'formula'
      const obj = bareObject(kind, kind === 'note' ? 'Note' : 'Formula', args)
      obj.parameters[kind === 'note' ? 'text' : 'latex'] = str(String(args[kind === 'note' ? 'text' : 'latex'] ?? ''))
      draft.objects.push(obj)
      return { ok: true, placed_index: draft.objects.length - 1 }
    }

    if (toolName === 'finish') return { ok: true }

    const componentId = toolNameToComponentId.get(toolName)
    if (!componentId) return { ok: false, error: `Unknown tool "${toolName}"` }
    const def = componentById(componentId)
    if (!def) return { ok: false, error: `Unknown component "${componentId}"` }

    // The model has no way to see its own draft between tool calls other
    // than what we tell it — nothing stops it from calling the SAME place_*
    // tool again for a part it already placed (this is a success, not an
    // error, so it never triggered the "stop re-placing things" recovery
    // message below). Observed in practice: whole hinge/rod/mass chains and
    // gate rows get built twice while a genuinely missing part (e.g. the
    // second mass of a double pendulum) never gets added at all, because the
    // step budget burns re-placing duplicates instead. Reject a same-part
    // placement within snapping distance of an already-placed instance and
    // point the model at the existing index instead.
    const dupX = Number(args.dx) || 0
    const dupY = Number(args.dy) || 0
    const DUP_RADIUS = 30
    const dupIndex = draft.objects.findIndex(
      (o) =>
        o.metadata.__aiComponentId === componentId &&
        Math.abs(o.position.x - dupX) <= DUP_RADIUS &&
        Math.abs(o.position.y - dupY) <= DUP_RADIUS
    )
    if (dupIndex !== -1) {
      return {
        ok: false,
        error: `A ${def.label} was already placed here (placed_index ${dupIndex}) — reuse that index instead of placing another one. If you meant a different, distinct part, place it further away.`,
      }
    }

    const obj = def.create({ x: dupX, y: dupY })
    obj.metadata.__aiComponentId = componentId
    if (typeof args.name === 'string' && args.name.trim()) obj.name = args.name
    if (typeof args.rotation === 'number') obj.rotation = args.rotation

    if (obj.geometry.kind === 'line' && typeof args.dx2 === 'number' && typeof args.dy2 === 'number') {
      const ex = args.dx2 - (Number(args.dx) || 0)
      const ey = args.dy2 - (Number(args.dy) || 0)
      obj.geometry.points = [[0, 0], [ex, ey]]
      obj.size = { w: Math.max(2, Math.abs(ex)), h: Math.max(2, Math.abs(ey)) }
    }

    for (const [key, value] of Object.entries(args)) {
      if (['dx', 'dy', 'dx2', 'dy2', 'name', 'rotation'].includes(key) || value === undefined || value === null) continue
      const expr = String(value)
      if (obj.parameters[key]?.kind === 'number') {
        obj.parameters[key] = num(expr)
        continue
      }
      for (const b of obj.behaviors) {
        if (b.params[key]?.kind === 'number') {
          b.params[key] = num(expr)
          break
        }
      }
    }

    draft.objects.push(obj)
    const result: ToolResult = { ok: true, placed_index: draft.objects.length - 1, name: obj.name }
    if (obj.geometry.kind === 'symbol') {
      result.terminals = terminalsOf(obj).map((t, i) => {
        const w = terminalWorld(obj, t)
        return { pin: i, x: Math.round(w.x), y: Math.round(w.y) }
      })
    }
    return result
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'tool execution failed' }
  }
}

// A real voltage/current source — supplies power, not just a logic level.
// digital's input/clock deliberately don't count here: they can drive a gate's
// logic input, but they don't supply the power an electrical/electronics part
// (resistor, LED, transistor…) needs, which is exactly the bug this catches —
// a transistor+LED circuit with an `input` for base drive but no battery
// "has a source" by name alone, yet the LED still never lights.
const POWER_SOURCES = new Set(['battery', 'ac-source', 'current-source', 'three-phase-source', 'vcvs', 'vccs', 'ccvs', 'cccs'])
const LOGIC_SOURCES = new Set(['input', 'clock'])
const ALL_SOURCES = new Set([...POWER_SOURCES, ...LOGIC_SOURCES])

/** Called right before honoring `finish` for a draft that placed any
 * electrical/electronics/digital symbol — runs the SAME netlist builder the
 * live solver uses (lib/circuit/engine.ts buildCircuit) against the draft as
 * it stands, so "is this actually wired up" is verified structurally instead
 * of trusted from the model's tool-call bookkeeping. Returns null if fine, or
 * a message to feed back as a blocking tool error otherwise. This is what
 * catches a transistor/resistor/LED left with dangling pins and no battery —
 * the individual placement and connect calls all "succeeded" but the result
 * still wasn't a real circuit. */
export function checkCircuitCompleteness(objects: SceneObject[]): string | null {
  if (!objects.some((o) => o.geometry.kind === 'symbol')) return null
  const circuit = buildCircuit(objects)
  if (!circuit) return null

  const netTermCount = new Map<number, number>()
  for (const c of circuit.comps) {
    for (const net of c.nets) netTermCount.set(net, (netTermCount.get(net) ?? 0) + 1)
  }
  const floating: string[] = []
  for (const c of circuit.comps) {
    const src = objects.find((o) => o.id === c.id)
    c.nets.forEach((net, ti) => {
      if ((netTermCount.get(net) ?? 0) <= 1) floating.push(`${src?.name ?? c.symbol} pin ${ti}`)
    })
  }
  if (floating.length > 0) {
    return `These pins aren't connected to anything, so the circuit won't do anything when Play is pressed: ${floating.join(', ')}. Call connect() to wire each one to where it belongs before finishing.`
  }

  const domainOf = (id: string) => objects.find((o) => o.id === id)?.geometry.domain
  const hasPowerSource = circuit.comps.some((c) => POWER_SOURCES.has(c.symbol))
  const hasLogicSource = circuit.comps.some((c) => LOGIC_SOURCES.has(c.symbol))

  const needsPower = circuit.comps.some(
    (c) => !ALL_SOURCES.has(c.symbol) && c.symbol !== 'gnd' && (domainOf(c.id) === 'electrical' || domainOf(c.id) === 'electronics')
  )
  if (needsPower && !hasPowerSource) {
    return "This circuit has electrical/electronics parts (resistor, LED, transistor…) but no battery/ac-source/current-source anywhere — a digital input/clock only supplies a logic-level signal, not the power those parts need. Add a real source and wire the whole loop back to it (via gnd or the source's other terminal) before finishing."
  }

  const needsLogic = circuit.comps.some((c) => !ALL_SOURCES.has(c.symbol) && domainOf(c.id) === 'digital')
  if (needsLogic && !hasPowerSource && !hasLogicSource) {
    return 'This digital circuit has gates/outputs but no input or clock driving it. Add one and connect it in before finishing.'
  }
  return null
}

function exprOf(p: ParamValue | undefined): string {
  if (!p) return ''
  if (p.kind === 'number') return p.expr
  if (p.kind === 'string') return p.value
  return String(p.value)
}

/** Convert the real SceneObjects built during the tool loop into the wire
 * format `import.ts` already knows how to place — the client re-creates
 * fresh objects from this via the SAME factories, so nothing server-side
 * ever reaches the canvas directly (docs/architecture.md's AI contract). */
export function draftToPayload(draft: DraftState, title: string, explanation: string): SimulationPayload {
  const idToIndex = new Map(draft.objects.map((o, i) => [o.id, i]))

  const objects: AiObject[] = draft.objects.map((obj) => {
    const isSymbol = obj.geometry.kind === 'symbol'
    const spec: AiObject = {
      geometry: obj.geometry.kind as AiObject['geometry'],
      symbol: obj.geometry.symbol,
      name: obj.name,
      dx: obj.position.x,
      dy: obj.position.y,
      w: obj.size.w,
      h: obj.size.h,
      rotation: obj.rotation || undefined,
      points: obj.geometry.points as [number, number][] | undefined,
      render: typeof obj.metadata.render === 'string' ? obj.metadata.render : undefined,
      behaviors: isSymbol
        ? []
        : obj.behaviors.map((b) => ({
            type: b.type,
            params: Object.fromEntries(Object.entries(b.params).map(([k, p]) => [k, exprOf(p)])),
          })),
    }
    if (isSymbol) {
      spec.params = Object.fromEntries(
        Object.entries(obj.parameters)
          .filter(([, p]) => p.kind === 'number')
          .map(([k, p]) => [k, exprOf(p)])
      )
    }
    if (obj.geometry.kind === 'note') spec.text = exprOf(obj.parameters.text)
    if (obj.geometry.kind === 'formula') spec.text = exprOf(obj.parameters.latex)
    if (obj.geometry.kind === 'graph') {
      spec.graphSource = idToIndex.get(exprOf(obj.parameters.sourceId))
      const yCh = exprOf(obj.parameters.yChannels)
      spec.graphChannels = yCh ? yCh.split(',') : []
    }
    return spec
  })

  return { title, explanation, variables: draft.variables, objects }
}
