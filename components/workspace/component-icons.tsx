'use client'

// A small icon per component in the palette — circuit/logic parts reuse the
// EXACT schematic glyph the canvas draws (SymbolIcon, extracted from
// components/objects/geometry.tsx) so there's zero drift between the icon
// and the real thing; everything else gets a small hand-drawn pictogram or a
// matching lucide icon, styled like lucide (24×24, currentColor, rounded
// joins) so it reads as part of the same icon language.

import {
  Circle,
  Disc,
  Layers,
  Minus,
  Radio,
  Square,
  Sun,
  TableProperties,
  Terminal,
  TrendingUp,
} from 'lucide-react'
import { SymbolIcon } from '@/components/objects/geometry'
import type { ComponentDef } from '@/lib/scene/factory'
import type { SceneObject } from '@/lib/scene/types'

// ── Hand-drawn pictograms — simple engineering-symbol style, 24×24 ────────

const iconProps = {
  viewBox: '0 0 24 24',
  width: '100%',
  height: '100%',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const ReferencePointIcon = () => (
  <svg {...iconProps}>
    <circle cx={12} cy={12} r={2.5} />
    <path d="M12 2v5.5M12 16.5V22M2 12h5.5M16.5 12H22" />
  </svg>
)

/** A fixed support — the standard "ground/anchor" hatch symbol. */
const GroundSupportIcon = () => (
  <svg {...iconProps}>
    <path d="M4 9h16" />
    <path d="M5 9l3 5M9.5 9l3 5M14 9l3 5M18.5 9l2 3.5" />
  </svg>
)

const SpringIcon = () => (
  <svg {...iconProps}>
    <path d="M2 12h3l2-6 3 12 3-12 3 12 3-12 2 6h3" />
  </svg>
)

const RopeIcon = () => (
  <svg {...iconProps}>
    <path d="M2 12c2-4 4-4 5-2s2 6 5 6 3-8 5-8 3 4 5 4" />
  </svg>
)

const DamperIcon = () => (
  <svg {...iconProps}>
    <path d="M2 12h6M20 12h-2" />
    <rect x="8" y="7" width="6" height="10" rx="0.5" />
    <path d="M18 7v10" />
  </svg>
)

const HingeIcon = () => (
  <svg {...iconProps}>
    <circle cx={12} cy={12} r={2.5} />
    <path d="M12 2v7.2M12 14.8V22" />
  </svg>
)

const MotorIcon = () => (
  <svg {...iconProps}>
    <circle cx={12} cy={12} r={7} />
    <path d="M15.5 8.5a5 5 0 1 1-7 0" />
    <path d="M8.5 8.5l0-2.2M8.5 8.5l-2.2 0" />
  </svg>
)

const ChargeIcon = () => (
  <svg {...iconProps}>
    <circle cx={12} cy={12} r={7} />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
)

const FieldLinesIcon = () => (
  <svg {...iconProps}>
    <path d="M3 6h14M17 6l-3-3M17 6l-3 3" />
    <path d="M3 12h14M17 12l-3-3M17 12l-3 3" />
    <path d="M3 18h14M17 18l-3-3M17 18l-3 3" />
  </svg>
)

const LensIcon = () => (
  <svg {...iconProps}>
    <path d="M9 3c-3 2.5-3 15.5 0 18" />
    <path d="M15 3c3 2.5 3 15.5 0 18" />
  </svg>
)

const MirrorIcon = () => (
  <svg {...iconProps}>
    <path d="M12 2v20" />
    <path d="M14 4l4 3M14 9l4 3M14 14l4 3M14 19l4 2" />
  </svg>
)

/** A projection screen — a solid bar catching the pattern beside it. */
const ScreenIcon = () => (
  <svg {...iconProps}>
    <path d="M6 2v20" strokeWidth={3.2} />
    <path d="M12 6v.01M16 9v.01M18 12v.01M16 15v.01M12 18v.01" strokeWidth={2.6} />
  </svg>
)

/** A barrier with a gap — the slit itself is the gap. */
const SlitIcon = () => (
  <svg {...iconProps}>
    <path d="M12 2v7M12 15v7" strokeWidth={3.2} />
  </svg>
)

const DashedLineIcon = () => (
  <svg {...iconProps}>
    <path d="M12 2v20" strokeDasharray="3 2.5" />
  </svg>
)

const TransmissionLineIcon = () => (
  <svg {...iconProps}>
    <path d="M2 9h20M2 15h20" />
  </svg>
)

const QuantumWellIcon = () => (
  <svg {...iconProps}>
    <path d="M3 5h5v10h8V5h5" />
  </svg>
)

const TunnelBarrierIcon = () => (
  <svg {...iconProps}>
    <path d="M3 17h5V7h8v10h5" />
  </svg>
)

const BeamIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="10" width="20" height="4" rx="1" />
  </svg>
)

/** Keyed by SceneObject.metadata.render — the factory's own stable per-item
 *  tag, already used to pick the canvas renderer for these non-symbol parts. */
const BY_RENDER: Record<string, React.ComponentType> = {
  'reference-point': ReferencePointIcon,
  ground: GroundSupportIcon,
  spring: SpringIcon,
  rope: RopeIcon,
  damper: DamperIcon,
  hinge: HingeIcon,
  motor: MotorIcon,
  charge: ChargeIcon,
  field: FieldLinesIcon,
  'light-source': Sun,
  lens: LensIcon,
  mirror: MirrorIcon,
  'optical-screen': ScreenIcon,
  slit: SlitIcon,
  'wave-source': Radio,
  'wave-boundary': DashedLineIcon,
  'transmission-line': TransmissionLineIcon,
  'quantum-well': QuantumWellIcon,
  'tunnel-barrier': TunnelBarrierIcon,
  system: Layers,
}

/** Keyed by component id — for the handful with no metadata.render at all
 *  (plain shapes) or that aren't part of geometry.tsx's world (DSA, cash
 *  flow, truth table). */
const BY_ID: Record<string, React.ComponentType> = {
  mass: Circle,
  block: Square,
  beam: BeamIcon,
  wheel: Disc,
  rod: Minus,
  'truth-table': TableProperties,
  cashflow: TrendingUp,
  'dsa-lab': Terminal,
}

// One dummy instance per component, built once — create() is a pure factory
// (the same call canvas.tsx makes when actually placing one), so this is
// exactly as cheap and safe as placing it, just never mounted to a page.
const dummyCache = new Map<string, SceneObject>()
function dummyFor(def: ComponentDef): SceneObject {
  let obj = dummyCache.get(def.id)
  if (!obj) {
    obj = def.create({ x: 0, y: 0 })
    dummyCache.set(def.id, obj)
  }
  return obj
}

export function ComponentIcon({ def }: { def: ComponentDef }) {
  const obj = dummyFor(def)
  if (obj.geometry.kind === 'symbol') return <SymbolIcon obj={obj} />
  const render = obj.metadata.render as string | undefined
  const Icon = (render && BY_RENDER[render]) || BY_ID[def.id] || Square
  return <Icon />
}
