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
  /** Hard bounds. The evaluated value is clamped to these in the store, so a
   *  typed literal, a variable or an AI/script import can't push a solver
   *  into NaN / tunnelling / a frozen tab. Every param must declare them. */
  min: number
  max: number
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
      { name: 'mass', label: 'Mass (kg)', default: '1', min: 0.01, max: 1000 },
      { name: 'friction', label: 'Friction', default: '0.1', min: 0, max: 2 },
      { name: 'restitution', label: 'Elasticity', default: '0.4', min: 0, max: 1 },
      { name: 'vx', label: 'Velocity X', default: '0', min: -30, max: 30 },
      { name: 'vy', label: 'Velocity Y', default: '0', min: -30, max: 30 },
      { name: 'omega', label: 'Angular velocity', default: '0', min: -50, max: 50 },
      { name: 'collide', label: 'Collides with bodies (0/1)', default: '1', min: 0, max: 1 },
      { name: 'showMotion', label: 'Tracer: motion vectors (0/1)', default: '0', min: 0, max: 1 },
      { name: 'showTrail', label: 'Tracer: path trail (0/1)', default: '0', min: 0, max: 1 },
      { name: 'showForces', label: 'Tracer: force arrows (0/1)', default: '0', min: 0, max: 1 },
    ],
  },
  {
    type: 'staticBody',
    label: 'Static Body',
    geometry: BODYLIKE,
    hint: 'Immovable collider — ground, wall, anchor.',
    live: true,
    params: [
      { name: 'friction', label: 'Friction', default: '0.4', min: 0, max: 2 },
      { name: 'restitution', label: 'Elasticity', default: '0.2', min: 0, max: 1 },
    ],
  },
  {
    type: 'spring',
    label: 'Spring',
    geometry: CONNECTOR,
    hint: 'Connects whatever its two endpoints touch.',
    live: true,
    params: [
      { name: 'k', label: 'Stiffness k (N/m)', default: '50', min: 0.1, max: 5000 },
      { name: 'damping', label: 'Damping ratio ζ (1 = critical)', default: '0.02', min: 0, max: 2 },
      { name: 'restScale', label: 'Rest length ×', default: '1', min: 0.1, max: 5 },
    ],
  },
  {
    type: 'rope',
    label: 'Rope',
    geometry: CONNECTOR,
    hint: 'Flexible link at fixed length.',
    live: true,
    params: [{ name: 'damping', label: 'Damping', default: '0.02', min: 0, max: 1 }],
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
    hint: 'Dashpot — a force c·v opposing the relative speed of its two ends (no restoring force of its own).',
    live: true,
    params: [{ name: 'damping', label: 'Damping c (N·s/m)', default: '5', min: 0, max: 500 }],
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
    params: [{ name: 'speed', label: 'Speed (rad/s)', default: '2', min: -50, max: 50 }],
  },
  {
    type: 'force',
    label: 'Force Field',
    geometry: BODYLIKE,
    hint: 'fx / fy expressions applied every frame (can use t and variables).',
    live: true,
    params: [
      { name: 'fx', label: 'Force X (N)', default: '0', min: -500, max: 500 },
      { name: 'fy', label: 'Force Y (N, + up)', default: '0', min: -500, max: 500 },
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
    params: [{ name: 'q', label: 'Charge (µC)', default: '1', min: -100, max: 100 }],
  },
  {
    type: 'efield',
    label: 'Electric Field Region',
    geometry: ['rect', 'circle'],
    hint: 'Uniform E field inside this region — accelerates charges (F = qE).',
    live: true,
    params: [
      { name: 'Ex', label: 'Ex (N/C)', default: '0', min: -10000, max: 10000 },
      { name: 'Ey', label: 'Ey (N/C)', default: '100', min: -10000, max: 10000 },
    ],
  },
  {
    type: 'bfield',
    label: 'Magnetic Field Region',
    geometry: ['rect', 'circle'],
    hint: 'Uniform B field (out of the page) — deflects moving charges (F = qv×B).',
    live: true,
    params: [{ name: 'Bz', label: 'Bz (T)', default: '1', min: -10, max: 10 }],
  },
  {
    type: 'dielectric',
    label: 'Dielectric Medium',
    geometry: ['rect', 'circle'],
    hint: 'Syllabus §2.7/§2.9: relative permittivity of the region. With a surface charge density σ it solves the parallel-plate case for real — E = σ/(ε₀εr), D = σ, and energy density u = ½εE² in SI units, not pedagogical ones.',
    live: true,
    params: [
      { name: 'epsr', label: 'Relative permittivity εr', default: '1', min: 1, max: 100 },
      { name: 'sigma', label: 'Surface charge density σ (µC/m²)', default: '0', min: -100, max: 100 },
      { name: 'mur', label: 'Relative permeability μr', default: '1', min: 0.5, max: 1000 },
    ],
  },
  {
    type: 'torsionSpring',
    label: 'Torsion Spring',
    geometry: ['circle', 'symbol'],
    hint: 'On a hinge — angular restoring torque toward a rest angle (torsion pendulum).',
    live: true,
    params: [
      { name: 'k', label: 'Torsion constant κ (N·m/rad)', default: '0.05', min: 0.0001, max: 50 },
      { name: 'restAngle', label: 'Rest angle (deg)', default: '0', min: -360, max: 360 },
    ],
  },
  {
    type: 'heatSource',
    label: 'Heat Source',
    geometry: BODYLIKE,
    hint: 'Injects/removes power (W); conducts to touching bodies; cools toward the page’s `ambient` variable. Power=0 turns a body into a plain conductor/thermometer.',
    live: true,
    params: [
      { name: 'power', label: 'Power (W)', default: '10', min: 0, max: 1000 },
      { name: 'conductivity', label: 'Conductivity k', default: '5', min: 0.1, max: 100 },
      { name: 'coolRate', label: 'Cooling rate', default: '0.05', min: 0, max: 1 },
      { name: 'tempInit', label: 'Initial temp (°C)', default: '20', min: -273, max: 1000 },
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
    hint: 'Coherent source (laser). In Play it shows light as a wave (crests, shorter in glass) and as photons (each one reflects OR refracts, slows to c/n, and lands on a Born-rule spot behind a slit). Rotate to aim; λ drives the ray tint AND the real interference math downstream — wave scale is 1 px = 25 nm (633 nm ≈ 25 px).',
    live: true,
    params: [
      { name: 'rays', label: 'Ray count', default: '7', min: 1, max: 50 },
      { name: 'aperture', label: 'Beam width (px)', default: '60', min: 1, max: 1000 },
      { name: 'wavelength', label: 'Wavelength λ (nm)', default: '633', min: 380, max: 780 }, // He–Ne laser
      { name: 'white', label: 'White light (0/1 — 0 = laser at λ)', default: '1', min: 0, max: 1 },
      // 0 rays only · 1 wave (moving crests, λ/n in glass) · 2 particle
      // (photons in Play) · 3 both — the same physics, two pictures.
      { name: 'nature', label: 'Show: 0 rays · 1 wave · 2 photons · 3 both', default: '3', min: 0, max: 3 },
    ],
  },
  {
    type: 'thinLens',
    label: 'Thin Lens',
    geometry: ['line'],
    hint: 'Paraxial thin lens (1/v − 1/u = 1/f). Place the source beyond 2f, at 2f and inside f to walk the classic imaging cases; negative f diverges.',
    live: true,
    params: [{ name: 'f', label: 'Focal length f (px)', default: '150', min: -2000, max: 2000 }],
  },
  {
    type: 'opticalMirror',
    label: 'Mirror',
    geometry: ['line'],
    hint: 'Specular reflection. f = 0 is a plane mirror; f > 0 concave (converging), f < 0 convex — mirror equation 1/v + 1/u = 1/f with f = R/2.',
    live: true,
    params: [{ name: 'f', label: 'Focal length f (px, 0 = plane)', default: '0', min: -2000, max: 2000 }],
  },
  {
    type: 'opticalScreen',
    label: 'Screen',
    geometry: ['line'],
    hint: 'Detector. Marks ray hits; behind a slit it shows the computed diffraction/interference intensity, and in Play photons accumulate one by one (Born rule).',
    live: true,
    params: [],
  },
  {
    type: 'slit',
    label: 'Slit',
    geometry: ['line'],
    hint: "Young's mask. Wave scale is 1 px = 25 nm, so λ (≈ 25 px) is comparable to the slits, as in any wave-optics demo. Defaults: double slit d = 60, a = 10 — fringes Δy = λL/d on the screen. Count 1 with a wide gap (≈ 60) is a single slit (minima at a sin θ = mλ); count > 2 is a grating (d sin θ = mλ).",
    live: true,
    params: [
      { name: 'gap', label: 'Slit width a (px)', default: '10', min: 1, max: 200 },
      { name: 'count', label: 'Slit count N (>2 = grating)', default: '2', min: 1, max: 20 },
      { name: 'spacing', label: 'Slit spacing d (px)', default: '60', min: 1, max: 500 },
    ],
  },
  {
    type: 'refractor',
    label: 'Glass (Refraction)',
    geometry: ['rect', 'polygon', 'circle'],
    hint: "The outline is a glass surface: Snell's law, total internal reflection and Fresnel reflection at every edge, with Cauchy dispersion — a triangle is a prism, a rect a slab, a circle a ball lens. Use a white source to split a spectrum.",
    live: true,
    params: [
      { name: 'n', label: 'Refractive index n (at 589 nm)', default: '1.52', min: 1, max: 3 },
      { name: 'dispersion', label: 'Dispersion B (µm², Cauchy)', default: '0.0042', min: 0, max: 0.05 },
    ],
  },
  {
    type: 'waveSource',
    label: 'Wave Source',
    geometry: ['circle'],
    hint: 'Uniform plane wave along its rotation. Set εr/μr/σ for the three syllabus media: lossless dielectric (σ=0), lossy (σ>0, decaying envelope) and good conductor (skin depth).',
    live: true,
    params: [
      { name: 'f', label: 'Frequency f', default: '1', min: 0.1, max: 10 },
      { name: 'E0', label: 'Amplitude E0 (px)', default: '40', min: 1, max: 200 },
      { name: 'epsr', label: 'Medium εr', default: '1', min: 1, max: 100 },
      { name: 'mur', label: 'Medium μr', default: '1', min: 1, max: 100 },
      { name: 'sigma', label: 'Medium σ (0 = lossless)', default: '0', min: 0, max: 10 },
    ],
  },
  {
    type: 'flow',
    label: 'Flow Animation',
    geometry: [],
    hint: 'Animates a diagram: tokens travel along this arrow, or this box lights up while a token is inside it. The timeline is written in the diagram (@1.5 a -> b : label); Play runs it.',
    live: true,
    params: [
      { name: 'speed', label: 'Speed ×', default: '1', min: 0.1, max: 10 },
      { name: 'loop', label: 'Repeat every (s, 0 = once)', default: '0', min: 0, max: 600 },
    ],
  },
  {
    type: 'waveBoundary',
    label: 'Wave Boundary',
    geometry: ['line'],
    hint: 'Where one material meets another (default: air → glass, εr2 = 4). A wave arriving from medium 1 partly bounces back (Γ) and partly goes through (τ); the returning wave interferes with the incoming one into a standing wave (SWR). Make medium 2 a conductor (σ > 0) to see the transmitted wave die out. Drag the line ends to resize.',
    live: true,
    params: [
      { name: 'f', label: 'Frequency f', default: '1', min: 0.1, max: 10 },
      { name: 'epsr1', label: 'Medium 1 εr', default: '1', min: 1, max: 100 },
      { name: 'mur1', label: 'Medium 1 μr', default: '1', min: 1, max: 100 },
      { name: 'sigma1', label: 'Medium 1 σ', default: '0', min: 0, max: 10 },
      { name: 'epsr2', label: 'Medium 2 εr', default: '4', min: 1, max: 100 },
      { name: 'mur2', label: 'Medium 2 μr', default: '1', min: 1, max: 100 },
      { name: 'sigma2', label: 'Medium 2 σ', default: '0', min: 0, max: 10 },
    ],
  },
  {
    type: 'transmissionLine',
    label: 'Transmission Line',
    geometry: ['line'],
    hint: 'A cable (coax / twin-lead) carrying a signal from a source to a load. If the load R equals Z0 the power is fully absorbed; otherwise part reflects and a standing wave forms along the cable — the dashed |V| envelope is what a voltmeter slid along it would read. A ¼λ line turns the load into Z0²/ZL at the source.',
    live: true,
    params: [
      { name: 'Z0', label: 'Z0 (Ω)', default: '50', min: 1, max: 1000 },
      { name: 'ZLre', label: 'Load R (Ω)', default: '100', min: 0, max: 10000 },
      { name: 'ZLim', label: 'Load X (Ω)', default: '0', min: -10000, max: 10000 },
      { name: 'lambdaFrac', label: 'Length (× λ)', default: '0.25', min: 0, max: 2 },
    ],
  },
  {
    type: 'quantumWell',
    label: 'Quantum Well',
    geometry: ['rect'],
    hint: 'Particle-in-a-box: ψn, |ψn|² and En = n²h²/8mL². Step n to watch nodes appear and levels spread as 1/L²; set m to superpose two states and press Play — the density sloshes with period 2πħ/(Em − En).',
    live: true,
    params: [
      { name: 'n', label: 'Quantum number n', default: '1', min: 1, max: 20 },
      { name: 'n2', label: 'Mix with state m (0 = pure)', default: '0', min: 0, max: 20 },
      { name: 'L', label: 'Well width L', default: '1', min: 0.1, max: 10 },
    ],
  },
  {
    type: 'tunnelBarrier',
    label: 'Tunnel Barrier',
    geometry: ['rect'],
    hint: 'Rectangular barrier, solved exactly: the plotted ψ is the real scattering state (interference in front, evanescent decay inside, transmitted wave behind). With E < V0 the particle still gets through — sweep E/V0 and width to map tunneling.',
    live: true,
    params: [
      { name: 'E', label: 'Particle energy E', default: '0.5', min: 0, max: 10 },
      { name: 'V0', label: 'Barrier height V0', default: '1', min: 0, max: 10 },
      { name: 'L', label: 'Barrier width L', default: '1', min: 0.1, max: 10 },
    ],
  },
]

// Single source of truth for "every behavior type that exists" — the AI tool
// schema (lib/ai/schema.ts) derives its zod enum from this so it can never
// drift out of sync with BEHAVIOR_SPECS again.
export const BEHAVIOR_TYPES = BEHAVIOR_SPECS.map((s) => s.type)

export const behaviorSpec = (type: BehaviorType): BehaviorSpec | undefined =>
  BEHAVIOR_SPECS.find((s) => s.type === type)

/** Clamp a behavior param to its declared bounds (unknown params pass through). */
export function clampParam(type: BehaviorType, name: string, value: number): number {
  const ps = behaviorSpec(type)?.params.find((p) => p.name === name)
  if (!ps || !Number.isFinite(value)) return ps && !Number.isFinite(value) ? Number(ps.default) : value
  return Math.min(ps.max, Math.max(ps.min, value))
}

export function specsForGeometry(kind: GeometryKind): BehaviorSpec[] {
  return BEHAVIOR_SPECS.filter((s) => s.geometry.length === 0 || s.geometry.includes(kind))
}

// Pure content/widget cards — a formula, a text block, a data table. Behaviors
// never make sense here (there's nothing to simulate), so the Properties
// panel hides the whole Behaviors section for these kinds. `sensor`'s empty
// geometry list (any kind) otherwise makes specsForGeometry() non-empty for
// these too, which used to wrongly surface "Convert to physics object" for
// e.g. a fresh text box — a dead end, since the panel it opens has nowhere to
// show that behavior. Single source both call sites read, so they can't drift.
export const NO_BEHAVIOR_KINDS: GeometryKind[] = [
  'note', 'text', 'formula', 'graph', 'surface3d', 'chart', 'cashflow', 'truthtable', 'steplab',
]

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
