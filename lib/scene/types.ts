// The universal object model, v2 — entity/component architecture.
//
// An object is GEOMETRY (dumb shape) + BEHAVIORS (attached meaning).
// A circle is just a circle until a `rigidBody` behavior is attached; then
// Play simulates it. A zigzag line with a `spring` behavior IS a spring.
// Nothing on the canvas is special-cased: notes, sketches and physical
// bodies share this one shape (see docs/architecture.md).

export interface Vec2 {
  x: number
  y: number
}

export interface NumericParam {
  kind: 'number'
  expr: string // user-editable expression: "5", "m", "density*volume"
  value: number // cached evaluation against the page scope
  error?: string
}

export interface StringParam {
  kind: 'string'
  value: string
}

export interface BoolParam {
  kind: 'bool'
  value: boolean
}

export type ParamValue = NumericParam | StringParam | BoolParam

// ── Geometry ────────────────────────────────────────────────────────────────

export type GeometryKind =
  | 'circle' // bbox-inscribed ellipse/circle
  | 'rect'
  | 'polygon' // closed; points relative to position, within size bbox
  | 'line' // two-point segment (also: beams, connectors)
  | 'stroke' // freehand ink, unrecognized
  | 'text'
  | 'note'
  | 'formula'
  | 'graph'
  | 'symbol' // schematic symbol (resistor, gate, hinge…)

export interface Geometry {
  kind: GeometryKind
  /** polygon/stroke/line: points relative to object position */
  points?: number[][]
  /** symbol: which glyph (e.g. 'resistor', 'and-gate', 'hinge') */
  symbol?: string
  /** symbol: domain it belongs to ('mechanics' | 'electrical' | …) */
  domain?: string
}

// ── Behaviors (components in the Unity sense) ───────────────────────────────

export type BehaviorType =
  | 'rigidBody' // dynamic body: mass, friction, restitution, velocity
  | 'staticBody' // immovable collider (ground, walls, anchors)
  | 'spring' // on line-ish geometry: connects whatever its endpoints touch
  | 'rope' // distance constraint
  | 'rod' // rigid link
  | 'damper' // dashpot
  | 'hinge' // revolute joint at this object's center (pins overlapping bodies)
  | 'motor' // drives angular velocity of the body it's attached to
  | 'force' // fx/fy expressions applied every frame
  | 'wire' // conductor: joins the circuit terminals it touches
  | 'electricalNode' // circuit solver participation (symbols)
  | 'charge' // point charge on a rigid body: Coulomb force + qE, qv×B
  | 'efield' // region behavior (rect/circle): uniform electric field inside it
  | 'bfield' // region behavior (rect/circle): uniform B field (out of plane) inside it
  | 'torsionSpring' // on a hinge: angular restoring torque toward a rest angle
  | 'heatSource' // thermal emission — see Phase F
  | 'sensor' // roadmap: triggers/measurement region
  | 'lightSource' // on a circle: fires a ray bundle for the optics ray tracer
  | 'thinLens' // on a line: paraxial thin-lens refraction (focal length f)
  | 'opticalMirror' // on a line: specular reflection
  | 'opticalScreen' // on a line: absorbs rays, marks where they land
  | 'slit' // on a line: blocks rays except through 1–2 gaps
  | 'custom'

export interface Behavior {
  id: string
  type: BehaviorType
  enabled: boolean
  params: Record<string, ParamValue>
}

// ── Scene object ────────────────────────────────────────────────────────────

export interface SceneObject {
  id: string
  name: string
  geometry: Geometry
  position: Vec2 // top-left of bbox, page coords
  size: { w: number; h: number }
  rotation: number // degrees, edit-time
  z: number
  behaviors: Behavior[]
  /** Content parameters (note text, formula latex, graph bindings…) */
  parameters: Record<string, ParamValue>
  metadata: Record<string, unknown>
}

export interface Variable {
  id: string
  name: string
  expr: string
  value: number
  error?: string
}

export interface PageDoc {
  objects: Record<string, SceneObject>
  variables: Variable[]
}

/** Tree metadata only — page content lives in the document store, keyed by id. */
export interface PageMeta {
  id: string
  name: string
}

export interface Section {
  id: string
  name: string
  color: string
  pages: PageMeta[]
}

export interface Notebook {
  id: string
  name: string
  emoji: string
  sections: Section[]
}

export const num = (expr: string | number, value?: number): NumericParam => {
  const e = String(expr)
  return { kind: 'number', expr: e, value: value ?? (Number.isFinite(Number(e)) ? Number(e) : 0) }
}

export const str = (value: string): StringParam => ({ kind: 'string', value })
export const bool = (value: boolean): BoolParam => ({ kind: 'bool', value })

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
