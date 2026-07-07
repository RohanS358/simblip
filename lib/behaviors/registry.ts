// Behavior registry — the extension point of the whole editor.
// A behavior declares its params and which geometry it can attach to; the
// inspector, the world builder and the AI importer all read this table.
// Adding a domain (thermal, optics…) = adding rows here + a solver.

import type { BehaviorType, GeometryKind, Behavior, ParamValue } from '@/lib/scene/types'
import { num, uid } from '@/lib/scene/types'

export interface BehaviorParamSpec {
  name: string
  label: string
  default: string // default expression
}

export interface BehaviorSpec {
  type: BehaviorType
  label: string
  /** Which geometry kinds this behavior can attach to. Empty = any. */
  geometry: GeometryKind[]
  params: BehaviorParamSpec[]
  /** One-line meaning shown in the Add Behavior menu. */
  hint: string
  /** Simulated by the current engine (false = registered, solver on roadmap). */
  live: boolean
}

const CONNECTOR: GeometryKind[] = ['line', 'stroke']
const BODYLIKE: GeometryKind[] = ['circle', 'rect', 'polygon', 'stroke', 'line']

export const BEHAVIOR_SPECS: BehaviorSpec[] = [
  {
    type: 'rigidBody',
    label: 'Rigid Body',
    geometry: BODYLIKE,
    hint: 'Mass, collisions, gravity — the shape becomes real.',
    live: true,
    params: [
      { name: 'mass', label: 'Mass (kg)', default: '1' },
      { name: 'friction', label: 'Friction', default: '0.1' },
      { name: 'restitution', label: 'Elasticity', default: '0.4' },
      { name: 'vx', label: 'Velocity X', default: '0' },
      { name: 'vy', label: 'Velocity Y', default: '0' },
      { name: 'omega', label: 'Angular velocity', default: '0' },
      { name: 'collide', label: 'Collides with bodies (0/1)', default: '1' },
      { name: 'showMotion', label: 'Tracer: motion vectors (0/1)', default: '0' },
      { name: 'showTrail', label: 'Tracer: path trail (0/1)', default: '0' },
      { name: 'showForces', label: 'Tracer: force arrows (0/1)', default: '0' },
    ],
  },
  {
    type: 'staticBody',
    label: 'Static Body',
    geometry: BODYLIKE,
    hint: 'Immovable collider — ground, wall, anchor.',
    live: true,
    params: [
      { name: 'friction', label: 'Friction', default: '0.4' },
      { name: 'restitution', label: 'Elasticity', default: '0.2' },
    ],
  },
  {
    type: 'spring',
    label: 'Spring',
    geometry: CONNECTOR,
    hint: 'Connects whatever its two endpoints touch.',
    live: true,
    params: [
      { name: 'k', label: 'Stiffness k', default: '20' },
      { name: 'damping', label: 'Damping', default: '0.05' },
      { name: 'restScale', label: 'Rest length ×', default: '1' },
    ],
  },
  {
    type: 'rope',
    label: 'Rope',
    geometry: CONNECTOR,
    hint: 'Flexible link at fixed length.',
    live: true,
    params: [{ name: 'damping', label: 'Damping', default: '0.02' }],
  },
  {
    type: 'rod',
    label: 'Rigid Rod',
    geometry: CONNECTOR,
    hint: 'Inextensible link — pendulum arms, linkages.',
    live: true,
    params: [],
  },
  {
    type: 'damper',
    label: 'Damper',
    geometry: CONNECTOR,
    hint: 'Dashpot — resists relative motion.',
    live: true,
    params: [{ name: 'damping', label: 'Damping', default: '0.3' }],
  },
  {
    type: 'hinge',
    label: 'Hinge',
    geometry: ['circle', 'symbol'],
    hint: 'Revolute joint — pins the bodies under it (or one body to the world).',
    live: true,
    params: [],
  },
  {
    type: 'motor',
    label: 'Motor',
    geometry: BODYLIKE,
    hint: 'Drives this body’s rotation at a target speed.',
    live: true,
    params: [{ name: 'speed', label: 'Speed (rad/s)', default: '2' }],
  },
  {
    type: 'force',
    label: 'Force Field',
    geometry: BODYLIKE,
    hint: 'fx / fy expressions applied every frame (can use t and variables).',
    live: true,
    params: [
      { name: 'fx', label: 'Force X', default: '0' },
      { name: 'fy', label: 'Force Y', default: '0' },
    ],
  },
  {
    type: 'wire',
    label: 'Wire',
    geometry: CONNECTOR,
    hint: 'Conductor — joins the circuit terminals it touches.',
    live: true,
    params: [],
  },
  {
    type: 'electricalNode',
    label: 'Electrical Node',
    geometry: ['symbol'],
    hint: 'Participates in the circuit solver (disable to take it offline).',
    live: true,
    params: [],
  },
  {
    type: 'charge',
    label: 'Point Charge',
    geometry: BODYLIKE,
    hint: 'Coulomb force with other charges, plus qE / qv×B inside field regions.',
    live: true,
    params: [{ name: 'q', label: 'Charge (µC)', default: '1' }],
  },
  {
    type: 'efield',
    label: 'Electric Field Region',
    geometry: ['rect', 'circle'],
    hint: 'Uniform E field inside this region — accelerates charges (F = qE).',
    live: true,
    params: [
      { name: 'Ex', label: 'Ex (N/C)', default: '0' },
      { name: 'Ey', label: 'Ey (N/C)', default: '100' },
    ],
  },
  {
    type: 'bfield',
    label: 'Magnetic Field Region',
    geometry: ['rect', 'circle'],
    hint: 'Uniform B field (out of the page) — deflects moving charges (F = qv×B).',
    live: true,
    params: [{ name: 'Bz', label: 'Bz (T)', default: '1' }],
  },
  {
    type: 'torsionSpring',
    label: 'Torsion Spring',
    geometry: ['circle', 'symbol'],
    hint: 'On a hinge — angular restoring torque toward a rest angle (torsion pendulum).',
    live: true,
    params: [
      { name: 'k', label: 'Stiffness κ', default: '5' },
      { name: 'restAngle', label: 'Rest angle (deg)', default: '0' },
    ],
  },
  {
    type: 'heatSource',
    label: 'Heat Source',
    geometry: BODYLIKE,
    hint: 'Injects/removes power (W); conducts to touching bodies; cools toward the page’s `ambient` variable. Power=0 turns a body into a plain conductor/thermometer.',
    live: true,
    params: [
      { name: 'power', label: 'Power (W)', default: '10' },
      { name: 'conductivity', label: 'Conductivity k', default: '5' },
      { name: 'coolRate', label: 'Cooling rate', default: '0.05' },
      { name: 'tempInit', label: 'Initial temp (°C)', default: '20' },
    ],
  },
  {
    type: 'sensor',
    label: 'Sensor',
    geometry: [],
    hint: 'Measurement region — graphs & triggers on the roadmap.',
    live: false,
    params: [],
  },
  {
    type: 'lightSource',
    label: 'Light Source',
    geometry: ['circle'],
    hint: 'Fires a parallel ray bundle along its rotation — rotate to aim.',
    live: true,
    params: [
      { name: 'rays', label: 'Ray count', default: '3' },
      { name: 'aperture', label: 'Beam width (px)', default: '80' },
      { name: 'wavelength', label: 'Wavelength (nm)', default: '550' },
    ],
  },
  {
    type: 'thinLens',
    label: 'Thin Lens',
    geometry: ['line'],
    hint: 'Paraxial thin lens — positive f converges, negative f diverges.',
    live: true,
    params: [{ name: 'f', label: 'Focal length f (px)', default: '150' }],
  },
  {
    type: 'opticalMirror',
    label: 'Mirror',
    geometry: ['line'],
    hint: 'Specular reflection off this line.',
    live: true,
    params: [],
  },
  {
    type: 'opticalScreen',
    label: 'Screen',
    geometry: ['line'],
    hint: 'Absorbs rays and marks where they land.',
    live: true,
    params: [],
  },
  {
    type: 'slit',
    label: 'Slit',
    geometry: ['line'],
    hint: 'Blocks rays except through 1–2 gaps — single/double-slit setups.',
    live: true,
    params: [
      { name: 'gap', label: 'Gap width (px)', default: '20' },
      { name: 'count', label: 'Slit count (1 or 2)', default: '1' },
      { name: 'spacing', label: 'Slit spacing (px)', default: '60' },
    ],
  },
  {
    type: 'waveSource',
    label: 'Wave Source',
    geometry: ['circle'],
    hint: 'Emits an animated plane wave along its rotation — set the medium (εr/μr/σ) to see lossless/lossy/conductor propagation.',
    live: true,
    params: [
      { name: 'f', label: 'Frequency f', default: '1' },
      { name: 'E0', label: 'Amplitude E0 (px)', default: '40' },
      { name: 'epsr', label: 'Medium εr', default: '1' },
      { name: 'mur', label: 'Medium μr', default: '1' },
      { name: 'sigma', label: 'Medium σ (0 = lossless)', default: '0' },
    ],
  },
  {
    type: 'waveBoundary',
    label: 'Wave Boundary',
    geometry: ['line'],
    hint: 'Normal-incidence interface between two declared media — shows Γ, τ and SWR.',
    live: true,
    params: [
      { name: 'f', label: 'Frequency f', default: '1' },
      { name: 'epsr1', label: 'Medium 1 εr', default: '1' },
      { name: 'mur1', label: 'Medium 1 μr', default: '1' },
      { name: 'sigma1', label: 'Medium 1 σ', default: '0' },
      { name: 'epsr2', label: 'Medium 2 εr', default: '4' },
      { name: 'mur2', label: 'Medium 2 μr', default: '1' },
      { name: 'sigma2', label: 'Medium 2 σ', default: '0' },
    ],
  },
  {
    type: 'transmissionLine',
    label: 'Transmission Line',
    geometry: ['line'],
    hint: 'Lossless line — Z0, load and electrical length determine Zin, Γ and the standing-wave pattern.',
    live: true,
    params: [
      { name: 'Z0', label: 'Z0 (Ω)', default: '50' },
      { name: 'ZLre', label: 'Load R (Ω)', default: '100' },
      { name: 'ZLim', label: 'Load X (Ω)', default: '0' },
      { name: 'lambdaFrac', label: 'Length (× λ)', default: '0.25' },
    ],
  },
  {
    type: 'quantumWell',
    label: 'Quantum Well',
    geometry: ['rect'],
    hint: 'Particle-in-a-box — wavefunction, probability density and the energy-level ladder.',
    live: true,
    params: [
      { name: 'n', label: 'Quantum number n', default: '1' },
      { name: 'L', label: 'Well width L', default: '1' },
    ],
  },
  {
    type: 'tunnelBarrier',
    label: 'Tunnel Barrier',
    geometry: ['rect'],
    hint: 'Rectangular barrier — transmission/reflection probability (quantum tunneling).',
    live: true,
    params: [
      { name: 'E', label: 'Particle energy E', default: '0.5' },
      { name: 'V0', label: 'Barrier height V0', default: '1' },
      { name: 'L', label: 'Barrier width L', default: '1' },
    ],
  },
]

// Single source of truth for "every behavior type that exists" — the AI tool
// schema (lib/ai/schema.ts) derives its zod enum from this so it can never
// drift out of sync with BEHAVIOR_SPECS again.
export const BEHAVIOR_TYPES = BEHAVIOR_SPECS.map((s) => s.type)

export const behaviorSpec = (type: BehaviorType): BehaviorSpec | undefined =>
  BEHAVIOR_SPECS.find((s) => s.type === type)

export function specsForGeometry(kind: GeometryKind): BehaviorSpec[] {
  return BEHAVIOR_SPECS.filter((s) => s.geometry.length === 0 || s.geometry.includes(kind))
}

export function createBehavior(type: BehaviorType): Behavior {
  const spec = behaviorSpec(type)
  const params: Record<string, ParamValue> = {}
  for (const p of spec?.params ?? []) params[p.name] = num(p.default)
  return { id: uid(), type, enabled: true, params }
}

/** Is this object physically present in the world when Play starts? */
export function isBody(behaviors: Behavior[]): 'dynamic' | 'static' | null {
  if (behaviors.some((b) => b.enabled && b.type === 'rigidBody')) return 'dynamic'
  if (behaviors.some((b) => b.enabled && b.type === 'staticBody')) return 'static'
  return null
}

export function connectorBehavior(behaviors: Behavior[]): Behavior | undefined {
  return behaviors.find(
    (b) => b.enabled && ['spring', 'rope', 'rod', 'damper'].includes(b.type)
  )
}
