'use client'

// Geometry renderer: circles, rects, polygons, lines/connectors, ink strokes
// and schematic symbols. Styling reflects attached behaviors — a circle with
// a rigidBody reads as matter, a bare sketch reads as ink. Same object, the
// behavior is the difference (docs/architecture.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SceneObject } from '@/lib/scene/types'
import { isBody, connectorBehavior } from '@/lib/behaviors/registry'
import { connectorPath, connectorElbowPath, connectorPoints } from '@/lib/render/connector-path'
import { terminalsOf } from '@/lib/circuit/engine'
import { inkPath } from './ink'
import { getNumber, getString, type ObjectRendererProps } from './types'
import { pxToCmRounded } from '@/lib/scene/units'
import { hasOpenedProperties } from '@/lib/scene/dblclick-policy'
import {
  traceRays,
  screenPatterns,
  tracePhoton,
  wavelengthColor,
  mixColor,
  opticParam,
  WHITE_NM,
  slitCenters,
  type ScreenPattern,
  type RayPath,
  type PhotonFlight,
  NM_PER_PX,
} from '@/lib/optics/engine'

// Light's two pictures, at the wave layer's display scale (1 px = NM_PER_PX
// nm, so 633 nm crests are ≈ 25 px apart — the same λ the interference math
// uses). Crests and photons travel at LIGHT_SPEED px/s, c/n inside glass.
const LIGHT_SPEED = 320
const PHOTON_RATE = 60 // photons emitted per second, per source object
const PHOTON_LIFETIME = 6 // s — photons escaping to infinity are dropped
const crestSpacing = (nm: number) => nm / NM_PER_PX
// White light before anything has split it: a warm, yellowish white, with a
// darker gold edge so it still reads on a light canvas.
const WARM_WHITE = '#fff2c2'
const WARM_EDGE = '#c9971a'

/** Deterministic 0..1 noise from an integer — lets Play-mode particle
 *  detections be a pure function of the clock (no per-frame state). */
function hash01(n: number): number {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** Draw a position (0..1) from a sampled density by inverse CDF. */
function sampleDensity(d: number[], u: number): number {
  const total = d.reduce((a, b) => a + b, 0) || 1
  let r = u * total
  for (let i = 0; i < d.length; i++) {
    r -= d[i]
    if (r <= 0) return i / (d.length - 1)
  }
  return 1
}

/** Cumulative display-time at each vertex of a photon path (dt = len·n/c). */
function flightTimes(r: RayPath): number[] {
  const out = [0]
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1]
    const b = r.points[i]
    out.push(out[i - 1] + (Math.hypot(b.x - a.x, b.y - a.y) * (r.n[i - 1] ?? 1)) / LIGHT_SPEED)
  }
  return out
}
import { useDocStore } from '@/lib/store/document'
import { RichTextArea } from './text'
import { useRuntimeStore, play, pause, stop, stepFrame } from '@/lib/physics/world'
import { PEN_STYLES, type PenStyle } from '@/lib/store/preferences'
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react'
import {
  C as cx,
  cAbs,
  cArg,
  propagationConstant,
  intrinsicImpedance,
  reflectionCoefficient,
  transmissionCoefficient as waveTransmission,
  swr,
  waveInstant,
  C_PX,
  lineInputImpedance,
  lineReflectionCoefficient,
  voltageEnvelope,
  boundaryField,
  lineVoltage,
  type Medium,
} from '@/lib/waves/engine'
import {
  energyLevel,
  transmissionCoefficient as quantumTransmission,
  superpositionDensity,
  superpositionRe,
  solveBarrier,
} from '@/lib/quantum/engine'

/** Auto-converted wires read as bronze conductors, distinct from amber UI accents. */
const WIRE_BRONZE = '#b5773a'

/** Seconds of Play for the wave/quantum figures, advanced on the display's
 *  own frames (≤ 30 Hz) — the runtime store's clock is throttled to ~7 Hz,
 *  which made traveling waves visibly stutter. 0 in edit, frozen on pause.
 *  Only subscribed objects re-render, and only while playing. */
function useAnimClock(active: boolean): number {
  const mode = useRuntimeStore((s) => (active ? s.mode : 'edit'))
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active) return
    if (mode === 'edit') {
      setT(0)
      return
    }
    if (mode !== 'running') return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000)
      last = now
      if (acc >= 1 / 30) {
        const add = acc
        acc = 0
        setT((x) => x + add)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, mode])
  return t
}

/** Dead-center text label inside a shape (rect/circle/polygon) — same
 *  RichTextArea every other text-carrying object uses (Note, Text). Not
 *  mounted at all until there's a reason to be: an untouched shape has zero
 *  extra DOM, so it never intercepts the shape's own click/drag/resize.
 *  `active` (true once the shape already carries text, or the wrapper's
 *  double-click asked for editing) is what mounts it; `autoEdit` only fires
 *  for the double-click case (no label yet) — a shape that already has text
 *  just re-mounts showing it, not forced straight into typing. */
function ShapeTextOverlay({
  pageId,
  object,
  selected,
  active,
  autoEdit,
}: ObjectRendererProps & { active: boolean; autoEdit: boolean }) {
  if (!active) return null
  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-1.5 text-center"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* No `hug` — a shape's label needs real width/height to actually
       *  receive clicks and show a caret; hug's w-max collapsed to 0×0 with
       *  no text typed yet, so nothing was ever clickable or visible.
       *  RichTextArea's own div is a plain top-aligned block, so the parent's
       *  flex-center only moved the (full-size) box, not the text inside it
       *  — className forces the actual lines to sit vertically centered too. */}
      <RichTextArea
        pageId={pageId}
        object={object}
        selected={selected}
        placeholder=""
        autoEdit={autoEdit}
        className="flex h-full flex-col justify-center text-center"
      />
    </div>
  )
}

/** Quadratic smoothing through midpoints — shared by live pen preview. */
export function pointsToPath(points: number[][]): string {
  if (points.length === 0) return ''
  if (points.length < 3) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[points.length - 1][0]} ${points[points.length - 1][1]}`
  }
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2
    const my = (points[i][1] + points[i + 1][1]) / 2
    d += ` Q ${points[i][0]} ${points[i][1]} ${mx} ${my}`
  }
  return d
}

function bodyFill(obj: SceneObject): { fill: string; stroke: string; strokeWidth: number; cornerRadius: number } {
  // Explicit per-object color (set by the Properties panel's shape-fill
  // control, or a pptx import reproducing a slide shape's <a:solidFill>/
  // <a:ln>) wins over the behavior-derived defaults below — a shape with a
  // physics body attached AND an explicit color keeps its chosen color; the
  // physics-state tint is only ever a fallback for shapes that never had
  // one set.
  const fillColor = obj.metadata.fillColor as string | undefined
  const strokeColor = obj.metadata.strokeColor as string | undefined
  const strokeWidth = (obj.metadata.strokeWidth as number | undefined) ?? (strokeColor ? 2 : 0)
  const cornerRadius = (obj.metadata.cornerRadius as number | undefined) ?? 0

  if (fillColor || strokeColor) {
    const kind = isBody(obj.behaviors)
    const fallback =
      kind === 'dynamic'
        ? 'color-mix(in oklch, var(--accent-blue) 22%, var(--card))'
        : kind === 'static'
          ? 'color-mix(in oklch, var(--muted-foreground) 18%, var(--card))'
          : 'transparent'
    const strokeFallback =
      kind === 'dynamic'
        ? 'var(--accent-blue)'
        : kind === 'static'
          ? 'var(--muted-foreground)'
          : strokeColor
            ? 'var(--foreground)'
            : 'none'
    return {
      fill: fillColor ?? fallback,
      stroke: strokeColor ?? strokeFallback,
      strokeWidth,
      cornerRadius: (obj.metadata.cornerRadius as number | undefined) ?? (kind ? 8 : 0),
    }
  }

  // Refracting glass (lib/optics/engine.ts): a pale blue body with a crisp
  // edge — the edge is the optical surface, so it has to read clearly.
  if (obj.behaviors.some((b) => b.enabled && b.type === 'refractor'))
    return {
      fill: 'color-mix(in oklch, var(--accent-blue) 14%, transparent)',
      stroke: 'color-mix(in oklch, var(--accent-blue) 70%, var(--foreground))',
      strokeWidth: (obj.metadata.strokeWidth as number | undefined) ?? 1.5,
      cornerRadius: (obj.metadata.cornerRadius as number | undefined) ?? 0,
    }
  const kind = isBody(obj.behaviors)
  if (kind === 'dynamic')
    return {
      fill: 'color-mix(in oklch, var(--accent-blue) 22%, var(--card))',
      stroke: 'var(--accent-blue)',
      strokeWidth: (obj.metadata.strokeWidth as number | undefined) ?? 2,
      cornerRadius: (obj.metadata.cornerRadius as number | undefined) ?? 8,
    }
  if (kind === 'static')
    return {
      fill: 'color-mix(in oklch, var(--muted-foreground) 18%, var(--card))',
      stroke: 'var(--muted-foreground)',
      strokeWidth: (obj.metadata.strokeWidth as number | undefined) ?? 2,
      cornerRadius: (obj.metadata.cornerRadius as number | undefined) ?? 8,
    }
  return {
    fill: 'transparent',
    stroke: 'var(--foreground)',
    strokeWidth: (obj.metadata.strokeWidth as number | undefined) ?? 2,
    cornerRadius: (obj.metadata.cornerRadius as number | undefined) ?? 8,
  }
}

// Dependent sources render as a diamond (vs. a circle for independent
// sources) per convention, labeled with the IEEE controlled-source letter:
// E=VCVS, F=CCCS, G=VCCS, H=CCVS.
function depSource(label: string) {
  return (
    <>
      <path d="M4 9.6 H22 M4 38.4 H22 M22 9.6 V38.4 M74 9.6 H92 M74 38.4 H92 M74 9.6 V38.4" fill="none" />
      <path d="M48 6 L74 24 L48 42 L22 24 Z" fill="none" />
      <text x="48" y="28" textAnchor="middle" fontSize="14" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">
        {label}
      </text>
    </>
  )
}

// Schematic glyphs in a 96×48 box. Recognizable beats ornate.
const GLYPHS: Record<string, React.ReactNode> = {
  resistor: <path d="M4 24 h14 l5 -12 10 24 10 -24 10 24 10 -24 5 12 h24" />,
  capacitor: <path d="M4 24 h36 M40 8 v32 M56 8 v32 M60 24 h32" />,
  inductor: (
    <path d="M4 24 h12 a8 8 0 0 1 16 0 a8 8 0 0 1 16 0 a8 8 0 0 1 16 0 a8 8 0 0 1 16 0 h12" fill="none" />
  ),
  battery: <path d="M4 24 h32 M36 10 v28 M48 17 v14 M48 24 h44 M60 6 v0" />,
  'ac-source': (
    <>
      <circle cx="48" cy="24" r="16" fill="none" />
      <path d="M38 24 q5 -10 10 0 t10 0 M4 24 h28 M64 24 h28" fill="none" />
    </>
  ),
  gnd: <path d="M48 6 v18 M32 24 h32 M38 31 h20 M44 38 h8" />,
  switch: <path d="M4 24 h24 M68 24 h24 M28 24 l32 -14 M64 24 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" />,
  diode: <path d="M4 24 h28 M32 12 v24 l28 -12 z M60 12 v24 M60 24 h32" />,
  led: (
    <>
      <path d="M4 24 h28 M32 12 v24 l28 -12 z M60 12 v24 M60 24 h32" />
      <path d="M52 8 l8 -6 M60 14 l8 -6" strokeWidth="1.4" />
    </>
  ),
  zener: <path d="M4 24 h28 M32 12 v24 l28 -12 z M64 8 L60 12 V36 L56 40 M60 24 h32" />,
  'current-source': (
    <>
      <circle cx="48" cy="24" r="16" fill="none" />
      <path d="M4 24 h28 M64 24 h28 M40 24 h12 M46 18 l6 6 -6 6" fill="none" />
    </>
  ),
  potentiometer: (
    <>
      <path d="M0 0 V10 H14 M82 10 H96 V0" fill="none" />
      <rect x="14" y="4" width="68" height="12" rx="2" fill="none" />
      <path d="M48 46 V18 M43 24 l5 -8 5 8" fill="none" />
    </>
  ),
  wattmeter: (
    <>
      <circle cx="48" cy="24" r="18" fill="none" />
      <path d="M4 9.6 H30 M4 38.4 H30 M66 9.6 H92 M66 38.4 H92" fill="none" />
      <text x="48" y="29" textAnchor="middle" fontSize="13" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">
        W
      </text>
    </>
  ),
  vcvs: depSource('E'),
  vccs: depSource('G'),
  ccvs: depSource('H'),
  cccs: depSource('F'),
  transformer: (
    <path
      d="M4 9.6 H30 M4 38.4 H30 M66 9.6 H92 M66 38.4 H92
         M30 9.6 a6 6 0 0 1 0 9.6 a6 6 0 0 1 0 9.6 a6 6 0 0 1 0 9.6
         M66 9.6 a6 6 0 0 0 0 9.6 a6 6 0 0 0 0 9.6 a6 6 0 0 0 0 9.6
         M44 4 V44 M52 4 V44"
      fill="none"
    />
  ),
  'transformer-ct': (
    <path
      d="M4 9.6 H30 M4 38.4 H30
         M30 9.6 a6 6 0 0 1 0 9.6 a6 6 0 0 1 0 9.6 a6 6 0 0 1 0 9.6
         M44 4 V44 M52 4 V44
         M66 4.8 a5 5 0 0 0 0 9.6 a5 5 0 0 0 0 9.6 a5 5 0 0 0 0 9.6 a5 5 0 0 0 0 9.6
         M66 4.8 H92 M66 43.2 H92 M78 24 H92"
      fill="none"
    />
  ),
  'three-phase-source': (
    <>
      <circle cx="48" cy="24" r="16" fill="none" />
      <path d="M19.2 0 V10 M48 0 V8 M76.8 0 V10 M48 40 V48" fill="none" />
      <text x="48" y="29" textAnchor="middle" fontSize="11" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">
        3~
      </text>
    </>
  ),
  'dc-machine': (
    <>
      <path d="M4 24 h16 M76 24 h16" fill="none" />
      <circle cx="48" cy="24" r="20" fill="none" />
      <g data-spin="" style={{ transformOrigin: '48px 24px' }}>
        <line x1="48" y1="24" x2="48" y2="8" strokeWidth={2} />
      </g>
      <text x="48" y="29" textAnchor="middle" fontSize="13" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">
        M
      </text>
    </>
  ),
  'induction-motor': (
    <>
      <path d="M4 9.6 H30 M4 24 H30 M4 38.4 H30 M68 24 H92" fill="none" />
      <circle cx="48" cy="24" r="18" fill="none" />
      <g data-spin="" style={{ transformOrigin: '48px 24px' }}>
        <line x1="48" y1="24" x2="48" y2="10" strokeWidth={2} />
      </g>
      <text x="48" y="29" textAnchor="middle" fontSize="10" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">
        3~M
      </text>
    </>
  ),
  'pressure-plate': (
    <>
      <path d="M4 24 h24 M68 24 h24 M28 24 l32 -10 M64 24 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" fill="none" />
      <path d="M20 4 h56" strokeWidth={3} fill="none" />
      <path d="M48 4 v9 M42 8 l6 6 6 -6" fill="none" />
    </>
  ),
  bjt: (
    <>
      <circle cx="48" cy="24" r="18" fill="none" />
      <path d="M40 12 v24 M40 20 l16 -12 M40 28 l16 12 M4 24 h36 M56 8 v-4 M56 40 v4" />
    </>
  ),
  'bjt-pnp': (
    <>
      <circle cx="48" cy="24" r="18" fill="none" />
      <path d="M40 12 v24 M40 20 l16 -12 M40 28 l16 12 M4 24 h36 M56 8 v-4 M56 40 v4" />
      <path d="M44 26.5 l-4 1.5 1.5 4" fill="none" />
    </>
  ),
  mosfet: <path d="M4 24 h28 M36 12 v24 M44 10 v8 M44 20 v8 M44 30 v8 M44 14 h24 v-8 M44 34 h24 v8 M44 24 h16" />,
  'mosfet-pmos': (
    <>
      <path d="M4 24 h22 M36 12 v24 M44 10 v8 M44 20 v8 M44 30 v8 M44 14 h24 v-8 M44 34 h24 v8 M44 24 h16" />
      <circle cx="29" cy="24" r="4" fill="none" />
    </>
  ),
  opamp: <path d="M24 6 v36 l48 -18 z M8 15 h16 M8 33 h16 M72 24 h16 M29 15 h6 M32 12 v6 M29 33 h6" />,
  // Variable-model symbols (N-input gates, mux, decoder) carry only their
  // body here — pin stubs are drawn dynamically from terminalsOf() so they
  // always line up with the chosen model. See STUB_EXTENTS below.
  'and-gate': <path d="M24 8 h28 a16 16 0 0 1 0 32 h-28 z" fill="none" />,
  'or-gate': <path d="M20 8 q14 16 0 32 q30 0 48 -16 q-18 -16 -48 -16 z" fill="none" />,
  'xor-gate': (
    <path d="M26 8 q14 16 0 32 q30 0 46 -16 q-16 -16 -46 -16 z M18 8 q14 16 0 32" fill="none" />
  ),
  'not-gate': <path d="M28 8 v32 l36 -16 z M64 24 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M4 24 h24 M72 24 h20" fill="none" />,
  'nand-gate': (
    <path d="M20 8 h28 a16 16 0 0 1 0 32 h-28 z M64 24 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0" fill="none" />
  ),
  'nor-gate': (
    <path d="M16 8 q14 16 0 32 q28 0 44 -16 q-16 -16 -44 -16 z M60 24 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0" fill="none" />
  ),
  bulb: (
    <>
      <circle cx="48" cy="24" r="14" fill="none" />
      <path d="M4 24 h30 M62 24 h30 M38 14 l20 20 M58 14 l-20 20" />
    </>
  ),
  fuse: <path d="M4 24 h12 M80 24 h12 M16 16 h64 v16 h-64 z M16 24 h64" fill="none" />,
  voltmeter: (
    <>
      <circle cx="48" cy="24" r="16" fill="none" />
      <path d="M4 24 h28 M64 24 h28 M42 16 l6 16 6 -16" fill="none" />
    </>
  ),
  ammeter: (
    <>
      <circle cx="48" cy="24" r="16" fill="none" />
      <path d="M4 24 h28 M64 24 h28 M42 32 l6 -16 6 16 M44 27 h8" fill="none" />
    </>
  ),
  probe: (
    <>
      <circle cx="48" cy="12" r="8" fill="none" />
      <path d="M48 20 v26 M44 40 l4 6 4 -6" />
    </>
  ),
  'logic-probe': (
    <>
      {/* square-wave badge instead of the analog circle */}
      <path d="M36 4 h24 v16 h-24 z" fill="none" />
      <path d="M40 16 h4 v-8 h4 v8 h4 v-8 h4" fill="none" />
      <path d="M48 20 v26 M44 40 l4 6 4 -6" />
    </>
  ),
  input: <path d="M8 10 h52 a6 6 0 0 1 6 6 v16 a6 6 0 0 1 -6 6 h-52 z M66 24 h26" fill="none" />,
  output: <path d="M4 24 h12 M16 24 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0" fill="none" />,
  clock: (
    <path d="M8 10 h52 a6 6 0 0 1 6 6 v16 a6 6 0 0 1 -6 6 h-52 z M16 32 h8 v-16 h8 v16 h8 v-16 h8 M66 24 h26" fill="none" />
  ),
  'd-ff': (
    <>
      <path d="M28 6 h44 v36 h-44 z M4 16 h24 M4 32 h24 M72 24 h20 M28 28 l7 4 -7 4" fill="none" />
      <text x="36" y="20" fontSize="11" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">D</text>
      <text x="60" y="28" fontSize="11" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">Q</text>
    </>
  ),
  mux: (
    <>
      <path d="M28 4 L64 14 V34 L28 44 z" fill="none" />
      <text x="38" y="28" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">MUX</text>
    </>
  ),
  'half-adder': (
    <>
      <path d="M26 6 h44 v36 h-44 z M4 16 h22 M4 32 h22 M70 16 h22 M70 32 h22" fill="none" />
      <text x="42" y="28" fontSize="10" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">HA</text>
    </>
  ),
  'full-adder': (
    <>
      <path d="M26 6 h44 v36 h-44 z M4 12 h22 M4 24 h22 M4 36 h22 M70 16 h22 M70 32 h22" fill="none" />
      <text x="42" y="28" fontSize="10" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">FA</text>
    </>
  ),
  'sr-latch': (
    <>
      <path d="M26 6 h44 v36 h-44 z M4 16 h22 M4 32 h22 M70 24 h22" fill="none" />
      <text x="42" y="28" fontSize="10" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">SR</text>
    </>
  ),
  'jk-ff': (
    <>
      <path d="M26 6 h44 v36 h-44 z M4 12 h22 M4 24 h22 M4 36 h22 M70 24 h22 M26 20 l7 4 -7 4" fill="none" />
      <text x="42" y="16" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">J</text>
      <text x="42" y="40" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">K</text>
      <text x="58" y="28" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">Q</text>
    </>
  ),
  decoder: (
    <>
      <path d="M26 4 h44 v40 h-44 z" fill="none" />
      <text x="34" y="28" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">DEC</text>
    </>
  ),
  comparator: (
    <>
      <path d="M26 4 h44 v40 h-44 z M4 16 h22 M4 32 h22 M70 12 h22 M70 24 h22 M70 36 h22" fill="none" />
      <text x="34" y="28" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">CMP</text>
    </>
  ),
  't-ff': (
    <>
      <path d="M28 6 h44 v36 h-44 z M4 16 h24 M4 32 h24 M72 24 h20 M28 28 l7 4 -7 4" fill="none" />
      <text x="36" y="20" fontSize="11" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">T</text>
      <text x="60" y="28" fontSize="11" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">Q</text>
    </>
  ),
  tristate: (
    <>
      <path d="M28 6 L28 42 L68 24 Z M4 16 H28 M4 32 H28 M68 24 H92" fill="none" />
      <text x="33" y="18.5" fontSize="7.5" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">A</text>
      <text x="33" y="35.5" fontSize="7.5" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">EN</text>
    </>
  ),
  demux: (
    <>
      <path d="M32 14 L32 34 L68 44 V4 Z" fill="none" />
      <text x="36" y="28" fontSize="8" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">DMX</text>
    </>
  ),
  encoder: (
    <>
      <path d="M26 4 h44 v40 h-44 z" fill="none" />
      <text x="34" y="28" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">ENC</text>
    </>
  ),
  'bcd-7seg': (
    <>
      <path d="M26 4 h44 v40 h-44 z" fill="none" />
      <text x="30" y="22" fontSize="7.5" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">BCD</text>
      <text x="32" y="33" fontSize="7.5" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">7SEG</text>
    </>
  ),
  register4: (
    <>
      <path d="M20 4 h56 v40 h-56 z" fill="none" />
      <text x="28" y="28" fontSize="9" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">SHIFT</text>
    </>
  ),
  counter4: (
    <>
      <path d="M20 4 h56 v40 h-56 z" fill="none" />
      <text x="30" y="28" fontSize="10" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">CTR4</text>
    </>
  ),
}

// Glow center per glowing symbol (viewBox coords).
const GLOW_POS: Record<string, { cx: number; cy: number; r: number }> = {
  led: { cx: 46, cy: 24, r: 16 },
  bulb: { cx: 48, cy: 24, r: 15 },
  output: { cx: 32, cy: 24, r: 15 },
}

// Body extents for variable-model symbols: where dynamic pin stubs stop on
// the left and start on the right (bottom stubs are vertical, into the body).
const STUB_EXTENTS: Record<string, { leftEnd: number; rightStart: number; topEnd?: number }> = {
  'and-gate': { leftEnd: 26, rightStart: 68 },
  'or-gate': { leftEnd: 24, rightStart: 68 },
  'xor-gate': { leftEnd: 21, rightStart: 72 },
  'nand-gate': { leftEnd: 22, rightStart: 72 },
  'nor-gate': { leftEnd: 20, rightStart: 68 },
  mux: { leftEnd: 30, rightStart: 64 },
  decoder: { leftEnd: 28, rightStart: 70 },
  demux: { leftEnd: 32, rightStart: 68 },
  encoder: { leftEnd: 26, rightStart: 70 },
  register4: { leftEnd: 20, rightStart: 76, topEnd: 4 },
}

// 7-segment display: each segment is a live pin (a..g, matching terminal
// order) — lit/dimmed by the same data-pin/data-state sync every other
// digital object's pin badges use (world.ts writes it generically).
const SEVEN_SEG_SEGMENTS = [
  'M48 6 H80', // a — top
  'M82 8 V22', // b — upper-right
  'M82 26 V40', // c — lower-right
  'M48 40 H80', // d — bottom
  'M46 26 V40', // e — lower-left
  'M46 8 V22', // f — upper-left
  'M48 23 H80', // g — middle
]
function SevenSegGlyph() {
  return (
    <>
      <path d={Array.from({ length: 7 }, (_, i) => `M0 ${((i + 1) / 8) * 48} H44`).join(' ')} fill="none" strokeWidth={1.5} opacity={0.6} />
      {SEVEN_SEG_SEGMENTS.map((d, i) => (
        <path
          key={i}
          data-pin={i}
          d={d}
          fill="none"
          strokeWidth={5}
          className="opacity-15 transition-opacity duration-100 data-[state='1']:opacity-100"
          stroke="var(--accent-mint)"
        />
      ))}
    </>
  )
}

/**
 * Just the symbol's shape — no terminals, no live-value chrome. Extracted so
 * a component palette/catalog can show the exact same schematic glyph as the
 * canvas without pulling in the interactive extras (see component-icons.tsx).
 */
export function SymbolIcon({ obj, className }: { obj: SceneObject; className?: string }) {
  const name = obj.geometry.symbol ?? ''
  const glyph = name === 'seven-seg' ? <SevenSegGlyph /> : GLYPHS[name]
  const glow = GLOW_POS[name]
  const terminals = terminalsOf(obj)
  const stubExt = STUB_EXTENTS[name]
  // Pin stubs generated from the live terminal layout (glyph space 96×48).
  const stubPath = stubExt
    ? terminals
        .map((td) =>
          td.y === 1
            ? `M${(td.x * 96).toFixed(1)} 46 V34`
            : td.y === 0 && stubExt.topEnd !== undefined
              ? `M${(td.x * 96).toFixed(1)} 2 V${stubExt.topEnd}`
              : td.x === 0
                ? `M4 ${(td.y * 48).toFixed(1)} H${stubExt.leftEnd}`
                : `M${stubExt.rightStart} ${(td.y * 48).toFixed(1)} H92`
        )
        .join(' ')
    : ''
  return (
    <svg
      viewBox="0 0 96 48"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      stroke="var(--foreground)"
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={obj.name}
      className={className}
    >
      {glow && (
        <circle
          data-glow=""
          cx={glow.cx}
          cy={glow.cy}
          r={glow.r}
          fill="var(--accent-amber)"
          stroke="none"
          style={{ opacity: 0, transition: 'opacity 120ms linear' }}
        />
      )}
      {stubPath && <path d={stubPath} fill="none" />}
      {glyph ?? (
        <>
          <rect x="16" y="8" width="64" height="32" rx="6" />
          <text
            x="48"
            y="29"
            textAnchor="middle"
            fill="var(--foreground)"
            stroke="none"
            fontSize="11"
            fontFamily="var(--font-jakarta)"
          >
            {obj.name.split(' ')[0]}
          </text>
        </>
      )}
    </svg>
  )
}

function SymbolGlyph({ obj }: { obj: SceneObject }) {
  const terminals = terminalsOf(obj)
  const digital = obj.geometry.domain === 'digital'
  const firstParam = Object.entries(obj.parameters).find(
    ([n, p]) => p.kind === 'number' && n !== 'inputs'
  )
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      <SymbolIcon obj={obj} />
      {firstParam && (
        <span className="pointer-events-none -mt-0.5 font-mono text-[9.5px] text-muted-foreground">
          {firstParam[0]}={firstParam[1].kind === 'number' ? firstParam[1].value : ''}
        </span>
      )}
      {/* live readout — the world runtime writes textContent during Play */}
      <span
        data-reading=""
        className="pointer-events-none absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-semibold text-[var(--accent-amber)]"
      />
      {/* connection terminals; digital pins get a live 0/1 badge */}
      {terminals.map((td, i) => (
        <span
          key={i}
          className="pointer-events-none absolute"
          style={{ left: `calc(${td.x * 100}% - 3px)`, top: `calc(${td.y * 100}% - 3px)` }}
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-[var(--accent-mint)] opacity-70" />
          {digital && (
            <span
              data-pin={i}
              className="absolute -top-3.5 left-1/2 -translate-x-1/2 font-mono text-[9.5px] font-bold text-muted-foreground data-[state=1]:text-[var(--accent-mint)]"
            />
          )}
        </span>
      ))}
    </div>
  )
}

export function GeometryObject({ pageId, object, selected }: ObjectRendererProps) {
  const { kind, points } = object.geometry
  // Text overlay mounts lazily — either the shape already carries a label,
  // or the user just double-clicked to add one. Resets when deselected so a
  // shape that ended up empty stops carrying the (now pointless) editor DOM.
  const hasLabel = getString(object, 'text').trim() !== ''
  const [editRequested, setEditRequested] = useState(false)
  useEffect(() => {
    if (!selected) setEditRequested(false)
  }, [selected])
  const labelActive = hasLabel || editRequested
  const { w, h } = object.size
  const { fill, stroke, strokeWidth: bodyStrokeWidth, cornerRadius } = bodyFill(object)
  const render = object.metadata.render as string | undefined
  const connector = connectorBehavior(object.behaviors)
  const hasHeat = object.behaviors.some((b) => b.enabled && b.type === 'heatSource')

  // Optics: a light source re-traces reactively against the WHOLE page
  // whenever anything moves, since ray paths are a pure function of the
  // current scene (no time-stepping engine needed — see lib/optics/engine.ts).
  const isLightSource = render === 'light-source'
  const pageObjects = useDocStore((s) => (isLightSource ? s.pages[pageId]?.objects : undefined))
  const rays = useMemo(() => {
    if (!isLightSource || !pageObjects) return []
    return traceRays(Object.values(pageObjects))
  }, [isLightSource, pageObjects])

  // Wave layer: Huygens–Fresnel interference on every screen behind a slit
  // (real single/double-slit physics at 1 px = 25 nm — lib/optics/engine.ts).
  const patterns = useMemo(() => {
    if (!isLightSource || !pageObjects) return []
    return screenPatterns(Object.values(pageObjects))
  }, [isLightSource, pageObjects])

  // Quantum layer: while the transport runs, photons land one by one at
  // Born-rule positions — the pattern builds up from individual detections.
  const playMode = useRuntimeStore((s) => (isLightSource ? s.mode : 'edit'))
  const [photons, setPhotons] = useState<{ s: number; t: number; j: number }[]>([])
  const isWhite = isLightSource && opticParam(object, 'lightSource', 'white', 0) >= 0.5
  // Patterns grouped by screen: a white source yields one per wavelength.
  const screenGroups = useMemo(() => {
    const m = new Map<string, ScreenPattern[]>()
    for (const p of patterns) m.set(p.screenId, [...(m.get(p.screenId) ?? []), p])
    return [...m.values()]
  }, [patterns])
  const photonPaths = useMemo(() => {
    const byPattern = new Map<number, string[]>()
    for (const ph of photons) {
      const pat = patterns[ph.s]
      if (!pat) continue
      const len = Math.hypot(pat.b.x - pat.a.x, pat.b.y - pat.a.y) || 1
      const nx = -(pat.b.y - pat.a.y) / len
      const ny = (pat.b.x - pat.a.x) / len
      const x = pat.a.x + (pat.b.x - pat.a.x) * ph.t + nx * (6 + ph.j) - object.position.x
      const y = pat.a.y + (pat.b.y - pat.a.y) * ph.t + ny * (6 + ph.j) - object.position.y
      const list = byPattern.get(ph.s) ?? []
      list.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0`)
      byPattern.set(ph.s, list)
    }
    return [...byPattern].map(([s, parts]) => ({ color: wavelengthColor(patterns[s].wavelengthNm), d: parts.join('') }))
  }, [photons, patterns, object.position.x, object.position.y])
  // Wave & particle views of the same light (param 'nature': 0 rays,
  // 1 wave, 2 photons, 3 both). Photons are traced one at a time
  // (lib/optics/engine.ts tracePhoton): each reflects OR refracts with the
  // Fresnel probability, slows to c/n in glass, and behind a slit lands at
  // a Born-rule position — the detections feed the build-up above.
  const nature = isLightSource ? Math.round(opticParam(object, 'lightSource', 'nature', 3)) : 0
  const showWave = nature === 1 || nature === 3
  const showPhotons = nature >= 2
  const lightClock = useAnimClock(isLightSource && nature > 0)
  const flightsRef = useRef<{ f: PhotonFlight; born: number; tAt: number[] }[]>([])
  const emittedRef = useRef(0)
  useEffect(() => {
    if (playMode === 'edit') setPhotons([])
  }, [playMode])
  useEffect(() => {
    if (lightClock === 0 || !showPhotons) {
      flightsRef.current = []
      emittedRef.current = lightClock * PHOTON_RATE
      return
    }
    if (playMode !== 'running' || !pageObjects) return
    const list = Object.values(pageObjects).filter((o) => o.id === object.id || !o.behaviors.some((b) => b.type === 'lightSource'))
    const due = Math.floor(lightClock * PHOTON_RATE - emittedRef.current)
    emittedRef.current += due
    const alive: typeof flightsRef.current = []
    const landed: { s: number; t: number; j: number }[] = []
    for (const fl of flightsRef.current) {
      const age = lightClock - fl.born
      if (age < fl.tAt[fl.tAt.length - 1] && age < PHOTON_LIFETIME) alive.push(fl)
      else if (fl.f.landed) landed.push({ ...fl.f.landed, j: (Math.random() - 0.5) * 8 })
    }
    for (let i = 0; i < Math.min(due, 12); i++) {
      const f = tracePhoton(list, patterns)
      if (f) alive.push({ f, born: lightClock - (i / PHOTON_RATE), tAt: flightTimes(f) })
    }
    flightsRef.current = alive
    if (landed.length) setPhotons((prev) => (prev.length >= 1400 ? prev : [...prev, ...landed]))
  }, [lightClock, showPhotons, playMode, pageObjects, patterns, object.id])

  // Wave source is the one new-domain object that animates continuously
  // (a traveling-wave snapshot) — it reads the runtime clock and freezes
  // outside Play, same rule the physics tracers already follow. The
  // conditional inside the selector (not around the hook) keeps every
  // OTHER object's render from being retriggered by the clock ticking.
  const waveTime = useAnimClock(
    render === 'wave-source' ||
      render === 'wave-boundary' ||
      render === 'transmission-line' ||
      render === 'quantum-well' ||
      render === 'tunnel-barrier'
  )

  const strokePath = useMemo(
    () => (kind === 'stroke' && points ? pointsToPath(points) : ''),
    [kind, points]
  )
  // Bare ink is the primary writing surface — render it as a pressure/
  // velocity-shaped filled outline instead of a uniform polyline.
  const bareInk =
    kind === 'stroke' && !isBody(object.behaviors) && !object.behaviors.some((b) => b.enabled && b.type === 'wire')
  const inkSize = typeof object.metadata.inkSize === 'number' ? object.metadata.inkSize : 5
  // Committed ink keeps the colour/style it was drawn with — changing your pen
  // settings later must not repaint everything you've already written.
  const inkColor = (object.metadata.inkColor as string) ?? 'var(--foreground)'
  const inkOpacity = PEN_STYLES[(object.metadata.inkStyle as PenStyle) ?? 'ink']?.opacity ?? 1
  const inkD = useMemo(
    () => (bareInk && points ? inkPath(points, { 
      size: inkSize,
      thinning: typeof object.metadata.sensitivity === 'number' ? object.metadata.sensitivity : undefined,
      dotSize: typeof object.metadata.dotSize === 'number' ? object.metadata.dotSize : undefined,
      smoothing: typeof object.metadata.smoothing === 'number' ? object.metadata.smoothing : undefined,
      streamline: typeof object.metadata.streamline === 'number' ? object.metadata.streamline : undefined,
    }) : ''),
    [bareInk, points, inkSize, object.metadata.sensitivity, object.metadata.dotSize, object.metadata.smoothing, object.metadata.streamline]
  )

  const flyingPaths = (() => {
    if (!showPhotons || lightClock === 0) return []
    const byColor = new Map<string, string[]>()
    for (const fl of flightsRef.current) {
      const age = lightClock - fl.born
      const { tAt, f } = fl
      let i = 0
      while (i < tAt.length - 2 && tAt[i + 1] < age) i++
      const a = f.points[i]
      const b = f.points[i + 1]
      if (!b) continue
      const u = Math.max(0, Math.min(1, (age - tAt[i]) / (tAt[i + 1] - tAt[i] || 1)))
      const x = a.x + (b.x - a.x) * u - object.position.x
      const y = a.y + (b.y - a.y) * u - object.position.y
      const c = isWhite && i < (f.shared ?? f.points.length) - 1 ? WARM_WHITE : wavelengthColor(f.wavelengthNm)
      const list = byColor.get(c) ?? []
      list.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0`)
      byColor.set(c, list)
    }
    return [...byColor].map(([color, parts]) => ({ color, d: parts.join('') }))
  })()

  /** Moving wavefront crests along segments [from, to) of a ray: spacing
   *  λ/n and phase speed c/n, so they bunch up inside glass. */
  const crests = (r: RayPath, from: number, to: number, nm: number, color: string, op: number, key: string) => {
    const lines = []
    let opl = 0
    for (let i = 0; i < r.points.length - 1 && i < to; i++) {
      const a = r.points[i]
      const b = r.points[i + 1]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const n = r.n[i] ?? 1
      if (i >= from) {
        const P = crestSpacing(nm) / n
        const D = ((((opl - LIGHT_SPEED * lightClock) / n) % P) + P) % P
        lines.push(
          <line
            key={`${key}-${i}`}
            x1={a.x - object.position.x}
            y1={a.y - object.position.y}
            x2={b.x - object.position.x}
            y2={b.y - object.position.y}
            stroke={color}
            strokeWidth={8}
            strokeDasharray={`2 ${Math.max(0.5, P - 2)}`}
            strokeDashoffset={D}
            opacity={0.7 * op}
          />
        )
      }
      opl += len * n
    }
    return lines
  }

  if (kind === 'symbol') return <SymbolGlyph obj={object} />

  // System boundary: a labeled dashed region. Purely declarative — the
  // canvas reads its domain to steer sketch recognition inside it.
  if (render === 'system') {
    const domain = (object.metadata.domain as string) ?? 'electrical'
    const tint: Record<string, string> = {
      mechanics: 'var(--accent-amber)',
      electrical: 'var(--accent-mint)',
      electronics: 'var(--accent-violet)',
      digital: 'var(--accent-blue)',
    }
    const c = tint[domain] ?? 'var(--accent-mint)'
    return <SystemBoundary pageId={pageId} object={object} domain={domain} color={c} />
  }

  // Reference point: a crosshair target that sticks to the body under it and
  // reports where that material point travels. Deliberately small and open in
  // the middle, so it reads as a MARKER on the mechanism rather than a part of
  // it — you must still see what it's pinned to.
  if (render === 'reference-point') {
    return (
      <svg width="100%" height="100%" viewBox="0 0 20 20" aria-label={object.name} className="overflow-visible">
        <circle cx={10} cy={10} r={8} fill="none" stroke="var(--accent-rose)" strokeWidth={1.5} />
        <circle cx={10} cy={10} r={1.8} fill="var(--accent-rose)" />
        <path
          d="M10 0 V4 M10 16 V20 M0 10 H4 M16 10 H20"
          stroke="var(--accent-rose)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    )
  }

  // Field region: a tinted zone any charge inside it feels. Direction hints
  // (arrows for E, dots for B-out-of-page) are decorative, not simulated —
  // the actual force comes from lib/physics/world.ts's live Ex/Ey/Bz params.
  if (render === 'field') {
    const isE = object.metadata.fieldKind !== 'b'
    const c = isE ? 'var(--accent-rose)' : 'var(--accent-violet)'
    const Ex = opticParam(object, 'efield', 'Ex', 0)
    const Ey = opticParam(object, 'efield', 'Ey', 100)
    const Bz = opticParam(object, 'bfield', 'Bz', 1)
    // SVG y grows downward while the solver treats +Ey as up (world.ts
    // applies fy += −q·Ey), so the on-screen field vector is (Ex, −Ey).
    const angle = (Math.atan2(-Ey, Ex) * 180) / Math.PI
    const hasDir = Ex !== 0 || Ey !== 0
    const into = Bz < 0
    const cols = Math.max(2, Math.round(w / 56))
    const rowsN = Math.max(2, Math.round(h / 48))
    const cells: { x: number; y: number }[] = []
    for (let r = 0; r < rowsN; r++)
      for (let col = 0; col < cols; col++)
        cells.push({ x: ((col + 0.5) / cols) * w, y: ((r + 0.5) / rowsN) * h })
    return (
      <div
        className="relative h-full w-full overflow-hidden rounded-2xl"
        style={{ border: `1.5px dashed ${c}`, background: `color-mix(in oklch, ${c} 6%, transparent)` }}
        aria-label={object.name}
      >
        <style>{`@keyframes sb-field-drift{0%{transform:translateX(0);opacity:0}18%{opacity:1}82%{opacity:1}100%{transform:translateX(13px);opacity:0}}@keyframes sb-field-pulse{from{opacity:.3}to{opacity:.75}}`}</style>
        <span
          className="absolute -top-2.5 left-4 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ background: 'var(--background)', color: c, border: `1px solid ${c}` }}
        >
          {isE ? 'E field' : `B field (${into ? 'into page' : 'out of page'})`}
        </span>
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="absolute inset-0">
          {isE
            ? cells.map((p, i) =>
                hasDir ? (
                  <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${angle})`} opacity={0.55}>
                    <path
                      d="M-11 0 H9 M3 -5 L9 0 L3 5"
                      stroke={c}
                      strokeWidth={1.6}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        animation: 'sb-field-drift 1.8s linear infinite',
                        animationDelay: `${-((p.x + p.y) / (w + h)) * 1.8}s`,
                      }}
                    />
                  </g>
                ) : (
                  <circle key={i} cx={p.x} cy={p.y} r={1.8} fill={c} opacity={0.35} />
                )
              )
            : cells.map((p, i) => (
                <g
                  key={i}
                  style={{
                    animation: 'sb-field-pulse 1.5s ease-in-out infinite alternate',
                    animationDelay: `${-((p.x + p.y) / (w + h)) * 1.5}s`,
                  }}
                >
                  <circle cx={p.x} cy={p.y} r={5.5} stroke={c} strokeWidth={1.4} fill="none" />
                  {into ? (
                    <path
                      d={`M${p.x - 2.7} ${p.y - 2.7} l5.4 5.4 m0 -5.4 l-5.4 5.4`}
                      stroke={c}
                      strokeWidth={1.4}
                    />
                  ) : (
                    <circle cx={p.x} cy={p.y} r={1.9} fill={c} />
                  )}
                </g>
              ))}
        </svg>
      </div>
    )
  }

  // Wave source: an animated plane wave emitted along its rotation axis —
  // amplitude decays with the medium's attenuation α, wavelength/speed set
  // by εr·μr (Hayt ch.11, lib/waves/engine.ts). The only wave/quantum object
  // that varies in time; freezes at a snapshot outside Play.
  if (render === 'wave-source') {
    const f = opticParam(object, 'waveSource', 'f', 1)
    const E0 = opticParam(object, 'waveSource', 'E0', 40)
    const medium: Medium = {
      epsr: opticParam(object, 'waveSource', 'epsr', 1),
      mur: opticParam(object, 'waveSource', 'mur', 1),
      sigma: opticParam(object, 'waveSource', 'sigma', 0),
    }
    const { alpha, beta } = propagationConstant(f, medium)
    const eta = intrinsicImpedance(f, medium)
    const etaAbs = cAbs(eta) || 1
    const etaArg = cArg(eta)
    const wt = 2 * Math.PI * f * waveTime
    const lambda = (2 * Math.PI) / (beta || 1e-9)
    const len = Math.max(260, Math.min(520, lambda * 2))
    const samples = Math.max(70, Math.min(240, Math.round((len / lambda) * 36)))
    // The textbook 3-D picture: E oscillates in the page plane, H in the
    // plane perpendicular to it — drawn along an oblique depth axis (DX, DY)
    // coming out of the page — and both travel along k. Stems from the axis
    // to each curve make the two planes read as solid sheets. In a lossy
    // medium H lags E by ∠η and both decay as e^{−αx}; |H| = |E|/|η|.
    const DX = 0.55
    const DY = 0.32
    const hA = E0 * Math.min(1.5, 1 / etaAbs)
    let dE = ''
    let dH = ''
    let stemsE = ''
    let stemsH = ''
    const stemEvery = Math.max(1, Math.round(samples / Math.max(1, len / lambda) / 10))
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * len
      const e = waveInstant(E0, beta, alpha, x, wt)
      const hv = hA * Math.exp(-alpha * x) * Math.cos(beta * x - wt - etaArg)
      const cmd = i === 0 ? 'M' : 'L'
      dE += `${cmd}${x.toFixed(1)} ${(-e).toFixed(1)}`
      dH += `${cmd}${(x + hv * DX).toFixed(1)} ${(hv * DY).toFixed(1)}`
      if (i % stemEvery === 0) {
        stemsE += `M${x.toFixed(1)} 0V${(-e).toFixed(1)}`
        stemsH += `M${x.toFixed(1)} 0L${(x + hv * DX).toFixed(1)} ${(hv * DY).toFixed(1)}`
      }
    }
    const skin = alpha > 1e-6 ? 1 / alpha : Infinity
    const v = C_PX / Math.sqrt(medium.epsr * medium.mur)
    const cx0 = w / 2
    const cy0 = h / 2
    const gid = `ws-${object.id}`
    const label = (x: number, y: number, t: string, color: string, anchor: 'start' | 'middle' = 'start') => (
      <text x={x} y={y} fontSize="10" fontWeight={600} textAnchor={anchor} fill={color} stroke="none" fontFamily="var(--font-jakarta)">{t}</text>
    )
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label={object.name}>
        <defs>
          <radialGradient id={gid} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="white" stopOpacity={0.9} />
            <stop offset="35%" stopColor="var(--accent-violet)" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--accent-violet) 55%, black)" />
          </radialGradient>
        </defs>
        <g transform={`translate(${cx0} ${cy0})`}>
          {/* H plane (horizontal sheet, seen obliquely) and E plane (page) */}
          <polygon
            points={`${-hA * DX},${-hA * DY} ${len - hA * DX},${-hA * DY} ${len + hA * DX},${hA * DY} ${hA * DX},${hA * DY}`}
            fill="color-mix(in oklch, var(--accent-mint) 9%, transparent)"
            stroke="var(--accent-mint)"
            strokeOpacity={0.25}
          />
          <rect x={0} y={-E0} width={len} height={2 * E0} fill="color-mix(in oklch, var(--accent-violet) 6%, transparent)" stroke="var(--accent-violet)" strokeOpacity={0.2} />
          <path d={stemsH} stroke="var(--accent-mint)" strokeWidth={1} opacity={0.45} />
          <path d={dH} fill="none" stroke="var(--accent-mint)" strokeWidth={2} />
          <line x1={0} y1={0} x2={len + 22} y2={0} stroke="var(--foreground)" strokeWidth={1.25} opacity={0.7} />
          <path d={`M${len + 22} 0l-8 -4v8z`} fill="var(--foreground)" opacity={0.7} />
          <path d={stemsE} stroke="var(--accent-violet)" strokeWidth={1} opacity={0.45} />
          <path d={dE} fill="none" stroke="var(--accent-violet)" strokeWidth={2.2} />
          {Number.isFinite(skin) && skin < len && (
            <g>
              <line x1={skin} y1={-E0 - 6} x2={skin} y2={E0 + 6} stroke="var(--accent-rose)" strokeDasharray="3 3" strokeWidth={1} />
              {label(skin, -E0 - 9, 'δ skin depth', 'var(--accent-rose)', 'middle')}
            </g>
          )}
          {label(4, -E0 - 6, 'E (electric field)', 'var(--accent-violet)')}
          {label(hA * DX + 6, hA * DY + 12, 'H (magnetic field)', 'var(--accent-mint)')}
          {label(len + 26, 4, 'k (travel)', 'var(--foreground)')}
        </g>
        <circle cx={cx0} cy={cy0} r={Math.min(w, h) / 2 - 1} fill={`url(#${gid})`} stroke="var(--foreground)" strokeWidth={1.25} />
        <text x={cx0} y={cy0 + E0 + hA * DY + 26} fontSize="9.5" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
          <tspan x={cx0}>{`λ = ${lambda.toFixed(0)} px   v = c/√(εr·μr) = ${v.toFixed(0)} px/s   |η| = ${etaAbs.toFixed(2)}∠${((etaArg * 180) / Math.PI).toFixed(0)}°`}</tspan>
          <tspan x={cx0} dy="12">
            {Number.isFinite(skin)
              ? `Lossy medium (σ > 0): the wave fades as e^(−αx); H lags E by ${((etaArg * 180) / Math.PI).toFixed(0)}°`
              : 'Lossless medium: E ⟂ H ⟂ k, in phase, constant amplitude'}
          </tspan>
        </text>
      </svg>
    )
  }

  // Quantum well (particle-in-a-box): wavefunction + probability density
  // plus a compact energy-level ladder. Pure function of n/L — stationary
  // state, no time dependence, no scene interaction (self-contained, like
  // efield/bfield — see lib/quantum/engine.ts).
  if (render === 'quantum-well') {
    const n = Math.max(1, Math.round(opticParam(object, 'quantumWell', 'n', 1)))
    const m = Math.max(0, Math.round(opticParam(object, 'quantumWell', 'n2', 0)))
    const L = Math.max(0.01, opticParam(object, 'quantumWell', 'L', 1))
    const mixed = m > 0 && m !== n
    const E1 = energyLevel(1, L)
    // Time in units of ħ/E₁ so the ground state turns once per 2π s and a
    // 1+2 mixture sloshes every 2π/3 s — ratios exact, scale watchable.
    const tq = waveTime / E1
    const En = energyLevel(n, L)
    // Layout: infinite walls left/right; inside, the energy levels with ψ
    // drawn ON its level (the textbook picture); below, a detector strip
    // with |ψ|² and — in Play — individual particle detections landing
    // at Born-rule positions, the same wave/particle story as the optics.
    const wallW = 12
    const padTop = 34
    const stripH = 38
    const x0 = wallW + 6
    const plotW = Math.max(10, w - 2 * x0 - 22)
    const wellBottom = h - stripH - 18
    const wellH = Math.max(20, wellBottom - padTop)
    const samples = 90
    const top = Math.min(8, Math.max(3, Math.max(n, m) + 1))
    const Emax = energyLevel(top, L)
    const yOf = (E: number) => wellBottom - (E / Emax) * (wellH - 6)
    const pts = Array.from({ length: samples }, (_, i) => {
      const x = (i / (samples - 1)) * L
      const re = superpositionRe(n, mixed ? m : n, L, x, tq) / (mixed ? 1 : Math.SQRT2)
      const p = mixed ? superpositionDensity(n, m, L, x, tq) : superpositionDensity(n, n, L, x, 0) / 2
      return { px: x0 + (i / (samples - 1)) * plotW, re, p }
    })
    const psiMax = Math.sqrt(2 / L) * (mixed ? Math.SQRT2 : 1)
    const levelY = mixed ? (yOf(En) + yOf(energyLevel(m, L))) / 2 : yOf(En)
    const gap = Math.max(8, yOf(energyLevel(Math.max(n, m || n), L)) - yOf(energyLevel(Math.max(n, m || n) + 1, L)))
    const psiAmp = Math.min(28, gap * 0.45 + 6)
    const psiPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.px.toFixed(1)} ${(levelY - (p.re / psiMax) * psiAmp).toFixed(1)}`).join('')
    const stripBase = h - 14
    const pMax = Math.max(1e-9, ...pts.map((p) => p.p))
    const probPath =
      `M${x0} ${stripBase}` + pts.map((p) => `L${p.px.toFixed(1)} ${(stripBase - (p.p / pMax) * (stripH - 8)).toFixed(1)}`).join('') + `L${x0 + plotW} ${stripBase}Z`
    // Particle detections: RATE per second, the last K visible, fading.
    const RATE = 12
    const K = 50
    const births = Math.floor(waveTime * RATE)
    const dots: { x: number; y: number; o: number }[] = []
    if (waveTime > 0) {
      const dens = pts.map((p) => p.p)
      for (let k = 0; k < Math.min(K, births); k++) {
        const j = births - k
        dots.push({ x: x0 + sampleDensity(dens, hash01(j)) * plotW, y: stripBase - 4 - hash01(j + 0.5) * (stripH - 14), o: 1 - k / K })
      }
    }
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label={object.name}>
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={8} fill="var(--card)" stroke="var(--border)" />
        {/* the box: two infinitely high walls */}
        {[x0 - wallW - 2, x0 + plotW + 2].map((wx, i) => (
          <g key={i}>
            <rect x={wx} y={padTop - 8} width={wallW} height={wellBottom - padTop + 8} fill="color-mix(in oklch, var(--foreground) 22%, transparent)" />
            {Array.from({ length: Math.floor((wellBottom - padTop) / 8) }, (_, k) => (
              <line key={k} x1={wx} y1={padTop + k * 8} x2={wx + wallW} y2={padTop + k * 8 - 6} stroke="var(--foreground)" strokeOpacity={0.35} />
            ))}
          </g>
        ))}
        <line x1={x0 - 2} y1={wellBottom} x2={x0 + plotW + 2} y2={wellBottom} stroke="var(--foreground)" strokeWidth={1.5} />
        <text x={x0 - wallW / 2 - 2} y={padTop - 11} textAnchor="middle" fontSize="8.5" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">V=∞</text>
        <text x={x0 + plotW + wallW / 2 + 2} y={padTop - 11} textAnchor="middle" fontSize="8.5" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">V=∞</text>
        {Array.from({ length: top }, (_, i) => {
          const level = i + 1
          const y = yOf(energyLevel(level, L))
          const active = level === n || (mixed && level === m)
          return (
            <g key={level}>
              <line x1={x0} y1={y} x2={x0 + plotW} y2={y} stroke={active ? 'var(--accent-amber)' : 'var(--muted-foreground)'} strokeWidth={active ? 1.5 : 1} strokeDasharray={active ? undefined : '3 4'} opacity={active ? 0.9 : 0.45} />
              <text x={x0 + plotW + wallW + 6} y={y + 3} fontSize="8.5" fill={active ? 'var(--accent-amber)' : 'var(--muted-foreground)'} fontFamily="var(--font-jakarta)">{`E${level}`}</text>
            </g>
          )
        })}
        <path d={psiPath} fill="none" stroke="var(--accent-violet)" strokeWidth={2} />
        {/* detector strip: where the particle is FOUND */}
        <line x1={x0} y1={stripBase} x2={x0 + plotW} y2={stripBase} stroke="var(--muted-foreground)" opacity={0.5} />
        <path d={probPath} fill="color-mix(in oklch, var(--accent-mint) 28%, transparent)" stroke="var(--accent-mint)" strokeWidth={1} />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={2.4} fill="var(--accent-rose)" opacity={d.o} />
        ))}
        <text x={x0} y={12} fontSize="10" fontWeight={600} fill="var(--foreground)" fontFamily="var(--font-jakarta)">
          {mixed ? `Particle in a box — (ψ${n}+ψ${m})/√2 sloshes, period ${((2 * Math.PI) / Math.abs(energyLevel(m, L) - En)).toFixed(2)}` : `Particle in a box — n = ${n}, E${n} = ${En.toFixed(2)}, ${n - 1} node${n === 2 ? '' : 's'}`}
        </text>
        <text x={x0} y={h - 3} fontSize="8.5" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
          {waveTime > 0 ? '|ψ|² — each dot is one detection of the particle' : '|ψ|² — where the particle is found (Play: detections)'}
        </text>
      </svg>
    )
  }

  // Tunnel barrier: the EXACT stationary scattering state (lib/quantum/
  // engine.ts solveBarrier) — incident+reflected interference on the left,
  // evanescent decay (or oscillation above the top) inside, the transmitted
  // wave on the right. Re Ψ turns at ω = E during Play; |ψ|² is stationary.
  // Tunnel barrier: rectangular barrier V0/L for a particle of energy E —
  // incident/reflected/transmitted amplitude schematic, T/R read directly
  // off the closed-form transmission coefficient (lib/quantum/engine.ts).
  if (render === 'tunnel-barrier') {
    const E = opticParam(object, 'tunnelBarrier', 'E', 0.5)
    const V0 = opticParam(object, 'tunnelBarrier', 'V0', 1)
    const L = Math.max(0.01, opticParam(object, 'tunnelBarrier', 'L', 1))
    const T = quantumTransmission(E, V0, L)
    const R = 1 - T
    const sol = solveBarrier(E, V0, L)
    const lambda = (2 * Math.PI) / sol.k
    const side = Math.max(2 * L, 1.5 * lambda)
    const x0 = -side
    const x1 = L + side
    const padX = 16
    const padTop = 26
    const plotW = w - padX * 2
    const plotH = h - padTop - 44
    const baseY = padTop + plotH
    const X = (x: number) => padX + ((x - x0) / (x1 - x0)) * plotW
    const barrierX0 = X(0)
    const barrierX1 = X(L)
    const eTop = Math.max(E, V0) * 1.25 || 1
    const eY = baseY - (E / eTop) * plotH
    const v0Y = baseY - (V0 / eTop) * plotH
    const N = 220
    const phase = E * waveTime
    const cph = Math.cos(phase)
    const sph = Math.sin(phase)
    const vals = Array.from({ length: N + 1 }, (_, i) => {
      const x = x0 + ((x1 - x0) * i) / N
      const p = sol.psi(x)
      // Re[ψ e^{−iEt}] = Re ψ cos Et + Im ψ sin Et
      return { x, re: p.re * cph + p.im * sph, d: p.re * p.re + p.im * p.im }
    })
    const dMax = Math.max(1e-9, ...vals.map((v) => v.d))
    const amp = Math.min(eY - padTop, 40) * 0.9
    const reScale = amp / Math.sqrt(dMax)
    const dScale = amp / dMax
    const rePath = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${X(v.x).toFixed(1)} ${(eY - v.re * reScale).toFixed(1)}`).join(' ')
    const dPath =
      `M ${X(x0)} ${eY} ` + vals.map((v) => `L ${X(v.x).toFixed(1)} ${(eY - v.d * dScale).toFixed(1)}`).join(' ') + ` L ${X(x1)} ${eY} Z`
    // Particle picture, in Play: particles fly in from the left one at a
    // time; each either tunnels through (probability T) or bounces back —
    // a pure function of the clock (hash01), so no per-frame state.
    const laneY = h - 20
    const RATE = 3
    const SPEED = plotW / 2.2 // px/s
    const births = waveTime > 0 ? Math.floor(waveTime * RATE) : 0
    const flying: { x: number; through: boolean }[] = []
    let through = 0
    for (let j = 1; j <= births; j++) {
      const pass = hash01(j) < T
      if (pass) through++
      const age = waveTime - j / RATE
      const dist = age * SPEED
      const toBarrier = barrierX0 - padX
      let x: number
      if (pass || dist < toBarrier) x = padX + dist
      else x = barrierX0 - (dist - toBarrier)
      if (x >= padX && x <= padX + plotW) flying.push({ x, through: pass })
    }
    const regionLabel = (x: number, t: string, y = padTop - 4) => (
      <text x={x} y={y} textAnchor="middle" fontSize="8.5" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">{t}</text>
    )
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible" aria-label={object.name}>
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={8} fill="var(--card)" stroke="var(--border)" />
        <line x1={padX} y1={baseY} x2={padX + plotW} y2={baseY} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.4} />
        <rect
          x={barrierX0}
          y={v0Y}
          width={Math.max(1, barrierX1 - barrierX0)}
          height={baseY - v0Y}
          fill="color-mix(in oklch, var(--accent-rose) 22%, transparent)"
          stroke="var(--accent-rose)"
          strokeWidth={1.5}
        />
        <text x={(barrierX0 + barrierX1) / 2} y={v0Y - 3} textAnchor="middle" fontSize="8.5" fill="var(--accent-rose)" stroke="var(--card)" strokeWidth={3} paintOrder="stroke" fontFamily="var(--font-jakarta)">{`wall V₀=${V0}`}</text>
        <line x1={padX} y1={eY} x2={padX + plotW} y2={eY} stroke="var(--accent-amber)" strokeWidth={1} strokeDasharray="4 3" />
        <text x={padX + plotW - 2} y={eY - 3} textAnchor="end" fontSize="8.5" fill="var(--accent-amber)" stroke="var(--card)" strokeWidth={3} paintOrder="stroke" fontFamily="var(--font-jakarta)">{`particle energy E=${E}`}</text>
        <path d={dPath} fill="color-mix(in oklch, var(--accent-mint) 25%, transparent)" stroke="var(--accent-mint)" strokeWidth={1} />
        <path d={rePath} fill="none" stroke="var(--accent-violet)" strokeWidth={1.6} />
        {regionLabel((padX + barrierX0) / 2, 'incoming + reflected wave')}
        {regionLabel((barrierX0 + barrierX1) / 2, E < V0 ? 'ψ decays inside' : 'passes over', baseY + 10)}
        {regionLabel((barrierX1 + padX + plotW) / 2, 'transmitted wave')}
        <text x={padX} y={12} fontSize="10" fontWeight={600} fill="var(--foreground)" fontFamily="var(--font-jakarta)">
          {E < V0 ? 'Quantum tunnelling — E < V₀, yet some particles get through' : 'Barrier scattering — E > V₀, yet some particles bounce back'}
        </text>
        {/* particle lane */}
        <line x1={padX} y1={laneY} x2={padX + plotW} y2={laneY} stroke="var(--muted-foreground)" opacity={0.25} />
        <rect x={barrierX0} y={laneY - 7} width={Math.max(1, barrierX1 - barrierX0)} height={14} fill="color-mix(in oklch, var(--accent-rose) 22%, transparent)" />
        {flying.map((p, i) => (
          <circle key={i} cx={p.x} cy={laneY} r={3} fill={p.through ? 'var(--accent-mint)' : 'var(--accent-violet)'} />
        ))}
        <text x={padX} y={h - 5} fontSize="9" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
          {`T = ${(T * 100).toFixed(T < 0.01 ? 3 : 1)}% get through · R = ${(R * 100).toFixed(1)}% bounce back` +
            (births > 0 ? `   —   observed ${through}/${births}` : '   (Play: fire particles)')}
        </text>
      </svg>
    )
  }

  // Wires (explicit behavior, or bare ink that may conduct): base path plus
  // two flow overlays the runtime animates — conventional current (amber
  // dashes) and electron flow (blue dots, opposite direction).
  const isWire = object.behaviors.some((b) => b.enabled && b.type === 'wire')
  const flowable = isWire || object.behaviors.length === 0

  const flowOverlays = (d: string) =>
    flowable && (
      <>
        <path
          data-flow="conv"
          d={d}
          fill="none"
          stroke="var(--accent-amber)"
          strokeWidth={3}
          strokeDasharray="6 10"
          strokeLinecap="round"
          style={{ opacity: 0 }}
        />
        <path
          data-flow="elec"
          d={d}
          fill="none"
          stroke="var(--accent-blue)"
          strokeWidth={2.5}
          strokeDasharray="2.5 13.5"
          strokeLinecap="round"
          style={{ opacity: 0 }}
        />
      </>
    )

  if (kind === 'line') {
    const pts = points ?? [[0, 0], [w, 0]]
    const a = pts[0]
    const b = pts[pts.length - 1]
    // If it's a simple line or has a special render mode (like spring, damper), use connectorPath.
    // Otherwise, draw the exact multipoint path.
    const isElbowConnector = render === 'connector'
    const isSpecial = render && ['spring', 'damper', 'rope', 'wire', 'connector'].includes(render)
    const bends = (object.metadata.bends as number[][] | undefined) ?? []
    const d = isElbowConnector
      ? connectorElbowPath(a[0], a[1], bends, b[0], b[1])
      : pts.length > 2 && !isSpecial
        ? `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(p => `L ${p[0]} ${p[1]}`).join(' ')
        : connectorPath(render, a[0], a[1], b[0], b[1])
    const OPTICS_STYLE: Record<string, { color: string; width: number }> = {
      lens: { color: 'var(--accent-violet)', width: 1 },
      mirror: { color: 'var(--accent-blue)', width: 4 },
      'optical-screen': { color: 'var(--muted-foreground)', width: 5 },
      slit: { color: 'var(--accent-amber)', width: 3 },
      'wave-boundary': { color: 'var(--accent-rose)', width: 3 },
      'transmission-line': { color: 'var(--accent-mint)', width: 3 },
    }
    const optics = render ? OPTICS_STYLE[render] : undefined
    // Attachment dots: mark where a connector/wire meets whatever it touches,
    // in the same color as the line itself.
    const endColor = connector ? 'var(--accent-mint)' : isWire ? WIRE_BRONZE : undefined
    return (
      <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
        {isElbowConnector && (
          <defs>
            <marker id={`arrow-start-${object.id}`} viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 10 0 L 0 5 L 10 10 z" fill="var(--accent-mint)" />
            </marker>
            <marker id={`arrow-end-${object.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-mint)" />
            </marker>
          </defs>
        )}
        <path
          data-connector={connector ? '' : undefined}
          data-wire={flowable ? '' : undefined}
          d={d}
          fill="none"
          stroke={render === 'measurement' ? 'var(--accent-rose)' : isWire ? WIRE_BRONZE : isElbowConnector ? 'var(--accent-mint)' : optics ? optics.color : connector ? 'var(--accent-mint)' : stroke}
          strokeWidth={render === 'measurement' ? 1.5 : isWire ? 2.5 : isElbowConnector ? 2.5 : optics ? optics.width : connector ? 2 : isBody(object.behaviors) ? 6 : 2}
          // A dashed connector is how a diagram draws an implied or optional
          // relation (`a --> b` in lib/scene/diagram.ts) — the one line style
          // the connector had no way to express.
          strokeDasharray={render === 'measurement' ? '5 4' : render === 'lens' ? '3 4' : object.metadata.dash ? '7 5' : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
          markerStart={isElbowConnector && object.metadata.startCap === 'arrow' ? `url(#arrow-start-${object.id})` : undefined}
          markerEnd={isElbowConnector && object.metadata.endCap === 'arrow' ? `url(#arrow-end-${object.id})` : undefined}
        />
        {isElbowConnector && selected && (() => {
          // Invisible wide hit-strips per segment so a selected connector's
          // interior shape can be dragged perpendicular to each segment —
          // canvas.tsx's handleObjectPointerDown reads data-connector-segment
          // /-axis off the pointer target to start the 'connectorReflow' gesture.
          // Uses the same connectorPoints() helper connectorElbowPath draws
          // with, so the hit-strips can never drift from what's on screen.
          // Everything here (a, bends, b) is object-local, matching how this
          // component reads object.metadata.bends everywhere else.
          const allPts = connectorPoints(a, bends, b)
          return allPts.slice(0, -1).map((p, i) => {
            const q = allPts[i + 1]
            const axis = Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]) ? 'h' : 'v'
            return (
              <line
                key={i}
                x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
                stroke="transparent"
                strokeWidth={14}
                data-connector-segment={i}
                data-connector-axis={axis}
                style={{ cursor: axis === 'h' ? 'ns-resize' : 'ew-resize', pointerEvents: 'stroke' }}
              />
            )
          })
        })()}
        {render === 'measurement' &&
          (() => {
            // Ruler ticks perpendicular to the line at each end, live
            // distance label at the midpoint — a specialized line+label
            // pairing (§8), not a new geometry kind or behavior.
            const dx = b[0] - a[0]
            const dy = b[1] - a[1]
            const len = Math.hypot(dx, dy) || 1
            const px = (-dy / len) * 6
            const py = (dx / len) * 6
            const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
            const cm = pxToCmRounded(len)
            return (
              <g stroke="var(--accent-rose)" strokeWidth={1.5}>
                <line x1={a[0] - px} y1={a[1] - py} x2={a[0] + px} y2={a[1] + py} />
                <line x1={b[0] - px} y1={b[1] - py} x2={b[0] + px} y2={b[1] + py} />
                <text
                  x={mid.x}
                  y={mid.y - 8}
                  textAnchor="middle"
                  fill="var(--accent-rose)"
                  stroke="none"
                  fontSize={11}
                  fontWeight={600}
                >
                  {cm} cm
                </text>
              </g>
            )
          })()}
        {render === 'lens' &&
          (() => {
            // A real glass lens, not a symbol: a symmetric biconvex (f > 0) or
            // biconcave (f < 0) body whose sag comes from the lensmaker's
            // equation with n = 1.5 (R = f, sag = h²/2R) — a stronger lens is
            // visibly fatter. The thin-lens plane stays as the dashed centre line.
            const f = opticParam(object, 'thinLens', 'f', 150)
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
            const nx = -(b[1] - a[1]) / len
            const ny = (b[0] - a[0]) / len
            const h = len / 2
            const sag = Math.max(3, Math.min(h * 0.6, (h * h) / (2 * Math.abs(f || 1e6))))
            const mx = (a[0] + b[0]) / 2
            const my = (a[1] + b[1]) / 2
            const at = (p: number[] | { x: number; y: number }, off: number) => {
              const [px, py] = Array.isArray(p) ? p : [p.x, p.y]
              return `${(px + nx * off).toFixed(1)} ${(py + ny * off).toFixed(1)}`
            }
            const m = { x: mx, y: my }
            // Quadratic curve peak = control/2, so control = 2 × wanted bulge.
            const d =
              f >= 0
                ? `M${at(a, 0)} Q${at(m, 2 * sag)} ${at(b, 0)} Q${at(m, -2 * sag)} ${at(a, 0)} Z`
                : (() => {
                    const e = sag + 3 // edge half-thickness; centre stays 3
                    return `M${at(a, e)} Q${at(m, 6 - e)} ${at(b, e)} L${at(b, -e)} Q${at(m, e - 6)} ${at(a, -e)} Z`
                  })()
            return (
              <g>
                <path
                  d={d}
                  fill="color-mix(in oklch, var(--accent-blue) 22%, transparent)"
                  stroke="color-mix(in oklch, var(--accent-blue) 75%, var(--foreground))"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
                {/* glint: a highlight along one face sells it as glass */}
                <path
                  d={`M${at({ x: a[0] + (b[0] - a[0]) * 0.25, y: a[1] + (b[1] - a[1]) * 0.25 }, f >= 0 ? sag * 0.9 : 3.5)} L${at({ x: a[0] + (b[0] - a[0]) * 0.4, y: a[1] + (b[1] - a[1]) * 0.4 }, f >= 0 ? sag * 1.35 : 3)}`}
                  stroke="white"
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={0.55}
                />
                {Math.abs(f) < 2000 &&
                  [-1, 1].map((sgn) => (
                    <g key={sgn} fill="var(--accent-violet)" fontSize={10} fontWeight={600}>
                      <circle cx={mx + nx * f * sgn} cy={my + ny * f * sgn} r={2.5} opacity={0.7} />
                      <text x={mx + nx * f * sgn} y={my + ny * f * sgn - 6} textAnchor="middle" opacity={0.7}>F</text>
                    </g>
                  ))}
              </g>
            )
          })()}
        {render === 'mirror' &&
          opticParam(object, 'opticalMirror', 'f', 0) !== 0 &&
          (() => {
            // Curved mirror: draw the real sag s = h²/(4f) (R = 2f) so a
            // concave mirror visibly cups toward +normal, a convex one bulges.
            const f = opticParam(object, 'opticalMirror', 'f', 0)
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
            const nx = -(b[1] - a[1]) / len
            const ny = (b[0] - a[0]) / len
            const sag = Math.max(-len / 3, Math.min(len / 3, ((len / 2) ** 2) / (4 * f)))
            const mx = (a[0] + b[0]) / 2 - nx * sag * 2
            const my = (a[1] + b[1]) / 2 - ny * sag * 2
            return <path d={`M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}`} fill="none" stroke={optics!.color} strokeWidth={3} />
          })()}
        {render === 'mirror' && (
          <g stroke={optics!.color} strokeWidth={1.5} opacity={0.6}>
            {(() => {
              const hatchCount = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 16))
              return Array.from({ length: hatchCount }, (_, i) => {
                const t = (i + 0.5) / hatchCount
                const x = a[0] + (b[0] - a[0]) * t
                const y = a[1] + (b[1] - a[1]) * t
                return <line key={i} x1={x} y1={y} x2={x - 8} y2={y + 6} />
              })
            })()}
          </g>
        )}
        {render === 'slit' && (
          <g stroke="var(--card)" strokeWidth={optics!.width + 2}>
            {(() => {
              const gap = opticParam(object, 'slit', 'gap', 10)
              const count = Math.max(1, Math.min(20, Math.round(opticParam(object, 'slit', 'count', 1))))
              const spacing = opticParam(object, 'slit', 'spacing', 60)
              const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
              const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
              const ux = (b[0] - a[0]) / len
              const uy = (b[1] - a[1]) / len
              const centers = slitCenters(count, spacing)
              return centers.map((c, i) => (
                <line
                  key={i}
                  x1={mid.x + ux * (c - gap / 2)}
                  y1={mid.y + uy * (c - gap / 2)}
                  x2={mid.x + ux * (c + gap / 2)}
                  y2={mid.y + uy * (c + gap / 2)}
                />
              ))
            })()}
          </g>
        )}
        {render === 'wave-boundary' &&
          (() => {
            const f = opticParam(object, 'waveBoundary', 'f', 1)
            const m1: Medium = {
              epsr: opticParam(object, 'waveBoundary', 'epsr1', 1),
              mur: opticParam(object, 'waveBoundary', 'mur1', 1),
              sigma: opticParam(object, 'waveBoundary', 'sigma1', 0),
            }
            const m2: Medium = {
              epsr: opticParam(object, 'waveBoundary', 'epsr2', 4),
              mur: opticParam(object, 'waveBoundary', 'mur2', 1),
              sigma: opticParam(object, 'waveBoundary', 'sigma2', 0),
            }
            const eta1 = intrinsicImpedance(f, m1)
            const eta2 = intrinsicImpedance(f, m2)
            const gamma = reflectionCoefficient(eta1, eta2)
            const tau = waveTransmission(eta1, eta2)
            const gAbs = cAbs(gamma)
            const s = swr(gAbs)
            const pc1 = propagationConstant(f, m1)
            const pc2 = propagationConstant(f, m2)
            const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
            const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
            // The interface is the drawn line; the wave travels NORMAL to it
            // (normal incidence), displacing along the line direction.
            const ux = (b[0] - a[0]) / segLen
            const uy = (b[1] - a[1]) / segLen
            // Normal chosen so a line drawn top→bottom puts medium 1 on the
            // LEFT and the wave arrives left→right, as in every textbook figure.
            const nx = uy
            const ny = -ux
            const span = Math.min(220, Math.max(80, (1.2 * 2 * Math.PI) / (pc1.beta || 1e-6)))
            const N = 90
            const amp = Math.min(18, segLen / 5)
            const wt = 2 * Math.PI * f * waveTime
            const tauAbs = cAbs(tau)
            const pt = (x: number, v: number) =>
              `${(mid.x + nx * x + ux * v * amp).toFixed(1)} ${(mid.y + ny * x + uy * v * amp).toFixed(1)}`
            const curve = (fn: (x: number) => number) =>
              Array.from({ length: N }, (_, i) => {
                const x = -span + (2 * span * i) / (N - 1)
                return `${i === 0 ? 'M' : 'L'} ${pt(x, fn(x))}`
              }).join(' ')
            // Envelope: |1 + Γe^{j2β₁x}| on the left, |τ|e^{−α₂x} on the right.
            const env = (x: number) =>
              x < 0
                ? Math.sqrt(1 + gAbs * gAbs + 2 * gAbs * Math.cos(2 * pc1.beta * x + cArg(gamma)))
                : tauAbs * Math.exp(-pc2.alpha * x)
            // Draw the two media as tinted half-spaces either side of the
            // interface, the incident and reflected waves faintly on the
            // left, and their sum (the standing-wave pattern) bold.
            const R = gAbs * gAbs
            const at = (x: number, along: number) => ({ x: mid.x + nx * x + ux * along, y: mid.y + ny * x + uy * along })
            const half = segLen / 2
            const poly = (x0: number, x1: number) =>
              [at(x0, -half), at(x1, -half), at(x1, half), at(x0, half)].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
            const curveOn = (from: number, to: number, fn: (x: number) => number) =>
              Array.from({ length: N }, (_, i) => {
                const x = from + ((to - from) * i) / (N - 1)
                return `${i === 0 ? 'M' : 'L'} ${pt(x, fn(x))}`
              }).join(' ')
            const txt = (p: { x: number; y: number }, t: string, color = 'var(--muted-foreground)', size = 9) => (
              <text x={p.x} y={p.y} textAnchor="middle" fontSize={size} fill={color} stroke="none" fontFamily="var(--font-jakarta)">{t}</text>
            )
            const tint2 = Math.min(40, 8 + 4 * Math.log2(m2.epsr * m2.mur) + (m2.sigma > 0 ? 10 : 0))
            return (
              <g>
                <polygon points={poly(-span, 0)} fill="color-mix(in oklch, var(--accent-blue) 7%, transparent)" />
                <polygon points={poly(0, span)} fill={`color-mix(in oklch, var(--accent-amber) ${tint2}%, transparent)`} />
                <path d={curve(env)} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
                <path d={curve((x) => -env(x))} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
                <path d={curveOn(-span, 0, (x) => Math.cos(wt - pc1.beta * x))} fill="none" stroke="var(--accent-blue)" strokeWidth={1} opacity={0.5} />
                <path d={curveOn(-span, 0, (x) => gAbs * Math.cos(wt + pc1.beta * x + cArg(gamma)))} fill="none" stroke="var(--accent-rose)" strokeWidth={1} opacity={0.6} />
                <path
                  d={curve((x) => boundaryField(x, wt, gamma, tau, pc1.beta, pc2.alpha, pc2.beta))}
                  fill="none"
                  stroke="var(--accent-violet)"
                  strokeWidth={2}
                />
                {txt(at(-span / 2, -half - 8), `Medium 1  εr=${m1.epsr}${m1.sigma ? ` σ=${m1.sigma}` : ''}`)}
                {txt(at(span / 2, -half - 8), `Medium 2  εr=${m2.epsr}${m2.sigma ? ` σ=${m2.sigma}` : ''}`)}
                {txt(at(-span / 2, half + 12), 'incident →', 'var(--accent-blue)')}
                {txt(at(-span / 2, half + 23), `← reflected (Γ = ${gAbs.toFixed(2)})`, 'var(--accent-rose)')}
                {txt(at(span / 2, half + 12), `transmitted (τ = ${tauAbs.toFixed(2)}) →`, 'var(--accent-violet)')}
                {txt(at(0, half + 38), `${(R * 100).toFixed(0)}% of the power reflects, ${(100 - R * 100).toFixed(0)}% goes through · SWR ${s.toFixed(2)}`, 'var(--foreground)', 9.5)}
              </g>
            )
          })()}
        {render === 'transmission-line' &&
          (() => {
            const Z0 = opticParam(object, 'transmissionLine', 'Z0', 50)
            const ZLre = opticParam(object, 'transmissionLine', 'ZLre', 100)
            const ZLim = opticParam(object, 'transmissionLine', 'ZLim', 0)
            const lambdaFrac = opticParam(object, 'transmissionLine', 'lambdaFrac', 0.25)
            const ZL = cx(ZLre, ZLim)
            const betaL = 2 * Math.PI * lambdaFrac
            const zin = lineInputImpedance(Z0, ZL, betaL)
            const gamma = lineReflectionCoefficient(Z0, ZL)
            const gAbs = cAbs(gamma)
            const s = swr(gAbs)
            const N = 40
            const env = voltageEnvelope(gamma, betaL, N)
            const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
            const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
            const ux = (b[0] - a[0]) / segLen
            const uy = (b[1] - a[1]) / segLen
            const nx = -uy
            const ny = ux
            const half = segLen / 2
            const amp = 10
            // a = source end (t=-half), b = load end (t=+half); env[0]=load.
            // Picture: generator ~ at the source end, a two-wire line, the
            // load ZL at the far end; above it the standing wave — dashed
            // |V| envelope (what a voltmeter slid along the line reads) and
            // the live voltage bouncing inside it during Play.
            const wtl = 2 * Math.PI * waveTime
            const C0 = -40 // centre of the standing-wave plot, along −normal
            const P = (t: number, off: number) => ({ x: mid.x + ux * t + nx * off, y: mid.y + uy * t + ny * off })
            const along = (fn: (i: number) => number) =>
              Array.from({ length: N }, (_, i) => {
                const q = P(half - (i / (N - 1)) * segLen, C0 - fn(i) * amp)
                return `${i === 0 ? 'M' : 'L'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`
              }).join(' ')
            const live = along((i) => lineVoltage(gamma, (i / (N - 1)) * betaL, wtl))
            const envTop = along((i) => env[i])
            const envBot = along((i) => -env[i])
            const wire = (off: number) => {
              const p = P(-half, off)
              const q = P(half, off)
              return <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--accent-mint)" strokeWidth={2.5} />
            }
            const gen = P(-half - 14, 0)
            const load = P(half + 10, 0)
            const txt = (q: { x: number; y: number }, t: string, color = 'var(--muted-foreground)', size = 9) => (
              <text x={q.x} y={q.y} textAnchor="middle" fontSize={size} fill={color} stroke="none" fontFamily="var(--font-jakarta)">{t}</text>
            )
            const R = gAbs * gAbs
            return (
              <g>
                {wire(-5)}
                {wire(5)}
                <circle cx={gen.x} cy={gen.y} r={10} fill="var(--card)" stroke="var(--foreground)" strokeWidth={1.5} />
                <path d={`M${gen.x - 6} ${gen.y} q3 -6 6 0 t6 0`} fill="none" stroke="var(--foreground)" strokeWidth={1.5} />
                <rect x={load.x - 7} y={load.y - 12} width={14} height={24} rx={2} fill="var(--card)" stroke="var(--accent-amber)" strokeWidth={1.5} />
                <path d={`M${load.x} ${load.y - 9} l-4 3 8 3 -8 3 8 3 -4 3`} fill="none" stroke="var(--accent-amber)" strokeWidth={1.2} />
                {txt(P(-half - 14, 24), 'source')}
                {txt(P(half + 10, 26), `load ${ZLre}${ZLim ? `${ZLim > 0 ? '+' : '−'}j${Math.abs(ZLim)}` : ''} Ω`, 'var(--accent-amber)')}
                {txt(P(0, 20), `line Z0 = ${Z0} Ω, length ${lambdaFrac}λ`)}
                <path d={envTop} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />
                <path d={envBot} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />
                <path d={live} fill="none" stroke="var(--accent-violet)" strokeWidth={1.75} />
                {txt(P(0, C0 - 2.2 * amp - 6), 'voltage along the line (dashed: |V| standing wave)')}
                {txt(P(0, 34), gAbs < 0.02 ? `Matched load — no reflection, Zin = ${Z0} Ω` : `${(R * 100).toFixed(0)}% of power reflects at the load · SWR ${s.toFixed(2)} · source sees Zin = ${zin.re.toFixed(0)}${zin.im >= 0 ? '+' : '−'}j${Math.abs(zin.im).toFixed(0)} Ω`, 'var(--foreground)', 9.5)}
              </g>
            )
          })()}
        {flowOverlays(d)}
        {/* A diagram animation token (lib/physics/flow.ts): hidden until the run
            clock puts one on this arrow, then moved and labelled by the runtime. */}
        {object.metadata.flow != null && object.behaviors.some((b) => b.enabled && b.type === 'flow') && (
          <g data-flow-token="" style={{ opacity: 0, pointerEvents: 'none' }}>
            <rect x={-16} y={-9} width={32} height={18} rx={9} fill="var(--accent-mint)" stroke="var(--card)" strokeWidth={1.5} />
            <text y={4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--background)" style={{ fontFamily: 'var(--font-mono)' }} />
          </g>
        )}
        {endColor && (
          <>
            <circle data-endpoint="a" cx={a[0]} cy={a[1]} r={3.5} fill={endColor} />
            <circle data-endpoint="b" cx={b[0]} cy={b[1]} r={3.5} fill={endColor} />
          </>
        )}
        {selected && (
          <>
            <circle cx={a[0]} cy={a[1]} r={4} fill="var(--ring)" />
            <circle cx={b[0]} cy={b[1]} r={4} fill="var(--ring)" />
          </>
        )}
      </svg>
    )
  }

  if (kind === 'stroke') {
    const strokePts = points ?? []
    const showEnds = isWire && !isBody(object.behaviors) && strokePts.length > 0
    return (
      <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
        {bareInk ? (
          // Ink body plus an invisible centerline: the circuit runtime still
          // finds a data-wire path to recolor if this doodle conducts.
          <>
            <path d={inkD} fill={inkColor} fillOpacity={inkOpacity} stroke="none" />
            <path
              data-wire=""
              d={strokePath}
              fill="none"
              stroke="transparent"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <path
            data-wire={flowable ? '' : undefined}
            d={strokePath}
            fill={isBody(object.behaviors) ? fill : 'none'}
            stroke={isWire && !isBody(object.behaviors) ? WIRE_BRONZE : stroke}
            strokeWidth={isWire ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {flowOverlays(strokePath)}
        {showEnds && (
          <>
            <circle cx={strokePts[0][0]} cy={strokePts[0][1]} r={3.5} fill={WIRE_BRONZE} />
            <circle
              cx={strokePts[strokePts.length - 1][0]}
              cy={strokePts[strokePts.length - 1][1]}
              r={3.5}
              fill={WIRE_BRONZE}
            />
          </>
        )}
      </svg>
    )
  }

  if (kind === 'polygon') {
    const pts = points ?? []
    const d = pts.length >= 3 ? `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')} Z` : ''
    return (
      <div className="relative h-full w-full" onDoubleClick={() => {
        // Shapes are "properties-then-edit": the FIRST double-click belongs to
        // the Properties panel (opened by the canvas wrapper). Only once that
        // has happened for this object does a double-click reach the label
        // editor. This handler fires BEFORE the wrapper's (child-to-parent
        // bubbling), so it has to ask the policy rather than be told.
        if (hasOpenedProperties(object.id)) setEditRequested(true)
      }}>
        <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
          <path d={d} fill={fill} stroke={stroke} strokeWidth={bodyStrokeWidth} strokeLinejoin="round" />
        </svg>
        <ShapeTextOverlay pageId={pageId} object={object} selected={selected} active={labelActive} autoEdit={editRequested} />
      </div>
    )
  }

  if (kind === 'circle') {
    const special = render === 'hinge' || render === 'motor' || render === 'charge'
    const chargeBehavior = render === 'charge' ? object.behaviors.find((b) => b.type === 'charge') : undefined
    const qParam = chargeBehavior?.params.q
    const qVal = qParam?.kind === 'number' ? qParam.value : 1
    const chargeColor = qVal < 0 ? 'var(--accent-blue)' : 'var(--accent-rose)'
    const myRays = isLightSource ? rays.filter((r) => r.sourceId === object.id) : []
    return (
      <div className="relative h-full w-full" onDoubleClick={() => {
        // Shapes are "properties-then-edit": the FIRST double-click belongs to
        // the Properties panel (opened by the canvas wrapper). Only once that
        // has happened for this object does a double-click reach the label
        // editor. This handler fires BEFORE the wrapper's (child-to-parent
        // bubbling), so it has to ask the policy rather than be told.
        if (hasOpenedProperties(object.id)) setEditRequested(true)
      }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label={object.name}>
        {/* Rays are traced in world space (rotation already baked into the
            beam direction); counter-rotate so the container's rotate()
            transform doesn't double-apply it. */}
        <g transform={object.rotation ? `rotate(${-object.rotation} ${w / 2} ${h / 2})` : undefined}>
          {myRays.map((r, i) => {
            const rel = (pts: { x: number; y: number }[]) =>
              `M ${pts.map((p) => `${(p.x - object.position.x).toFixed(1)} ${(p.y - object.position.y).toFixed(1)}`).join(' L ')}`
            const shared = r.shared ?? r.points.length
            const op = 0.85 * Math.max(0.2, r.intensity)
            // White light: the undispersed stretch is common to every
            // wavelength and drawn ONCE, white; only after the first
            // dispersive surface does each wavelength get its own colour.
            return (
              <g key={i}>
                {isWhite && shared >= 2 && r.wavelengthNm === WHITE_NM[0] && (
                  <g opacity={showWave ? op * 0.5 : op}>
                    <path d={rel(r.points.slice(0, shared))} fill="none" stroke={WARM_EDGE} strokeWidth={3} opacity={0.45} />
                    <path d={rel(r.points.slice(0, shared))} fill="none" stroke={WARM_WHITE} strokeWidth={1.5} />
                  </g>
                )}
                {(!isWhite || shared < r.points.length) && (
                  <path
                    d={rel(isWhite ? r.points.slice(Math.max(0, shared - 1)) : r.points)}
                    fill="none"
                    stroke={wavelengthColor(r.wavelengthNm)}
                    strokeWidth={1.5}
                    opacity={showWave ? op * 0.35 : op}
                  />
                )}
                {showWave &&
                  (isWhite
                    ? [
                        ...(shared >= 2 && r.wavelengthNm === WHITE_NM[0] ? crests(r, 0, shared - 1, 550, WARM_EDGE, op, 'w') : []),
                        ...crests(r, Math.max(0, shared - 1), r.points.length, r.wavelengthNm, wavelengthColor(r.wavelengthNm), op, 'c'),
                      ]
                    : crests(r, 0, r.points.length, r.wavelengthNm, wavelengthColor(r.wavelengthNm), op, 'c'))}
                {r.hitScreen && (
                  <circle
                    cx={r.hitScreen.x - object.position.x}
                    cy={r.hitScreen.y - object.position.y}
                    r={2.5}
                    fill={wavelengthColor(r.wavelengthNm)}
                    opacity={op}
                  />
                )}
              </g>
            )
          })}
          {/* Diffraction, wave view: every open gap re-radiates circular
              wavelets (Huygens) toward the screen; where crests from two
              gaps cross you can see the bright/dark directions form. */}
          {showWave &&
            patterns
              .filter((p) => p.sourceId === object.id && (!isWhite || p.wavelengthNm === WHITE_NM[3]))
              .map((p, pi) => {
                const lam = crestSpacing(p.wavelengthNm)
                const base = (((LIGHT_SPEED * lightClock) % lam) + lam) % lam
                const aim = Math.atan2(p.toward.y, p.toward.x)
                const SPAN = (75 * Math.PI) / 180
                const arcs: string[] = []
                for (const o of p.openings) {
                  for (let r = base || lam; r < p.reach; r += lam) {
                    const x0 = o.x + r * Math.cos(aim - SPAN) - object.position.x
                    const y0 = o.y + r * Math.sin(aim - SPAN) - object.position.y
                    const x1 = o.x + r * Math.cos(aim + SPAN) - object.position.x
                    const y1 = o.y + r * Math.sin(aim + SPAN) - object.position.y
                    arcs.push(`M${x0.toFixed(1)} ${y0.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`)
                  }
                }
                return (
                  <path
                    key={`wl-${pi}`}
                    d={arcs.join('')}
                    fill="none"
                    stroke={isWhite ? WARM_EDGE : wavelengthColor(p.wavelengthNm)}
                    strokeWidth={1.6}
                    opacity={0.45}
                  />
                )
              })}
          {/* Interference: one gradient band per screen (the colours a real
              screen shows — white centre, tinted edges for white light), an
              |A|² curve per wavelength, and Born-rule photons. */}
          {isLightSource &&
            screenGroups.map((grp, gi) => {
              const ox = object.position.x
              const oy = object.position.y
              const { a, b } = grp[0]
              const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
              // outward normal of the screen line, curve drawn on that side
              const nx = -(b.y - a.y) / len
              const ny = (b.x - a.x) / len
              const CURVE = 46
              const STOPS = 160
              const at = (pat: ScreenPattern, t: number) => pat.intensity[Math.round(t * (pat.intensity.length - 1))] ?? 0
              const gradId = `fringe-${object.id}-${gi}`
              return (
                <g key={`pat-${gi}`}>
                  <defs>
                    <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={a.x - ox} y1={a.y - oy} x2={b.x - ox} y2={b.y - oy}>
                      {Array.from({ length: STOPS }, (_, k) => {
                        const t = k / (STOPS - 1)
                        const { color, alpha } = mixColor(grp.map((pat) => ({ nm: pat.wavelengthNm, I: at(pat, t) })))
                        return <stop key={k} offset={t} stopColor={color} stopOpacity={Math.min(1, alpha * 1.1)} />
                      })}
                    </linearGradient>
                  </defs>
                  <line
                    x1={a.x + nx * 6 - ox}
                    y1={a.y + ny * 6 - oy}
                    x2={b.x + nx * 6 - ox}
                    y2={b.y + ny * 6 - oy}
                    stroke={`url(#${gradId})`}
                    strokeWidth={10}
                  />
                  {grp.map((pat, pi) => {
                    const n = pat.intensity.length
                    const d = pat.intensity
                      .map((I, i) => {
                        const t = i / (n - 1)
                        const px = a.x + (b.x - a.x) * t + nx * (12 + I * CURVE) - ox
                        const py = a.y + (b.y - a.y) * t + ny * (12 + I * CURVE) - oy
                        return `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`
                      })
                      .join(' ')
                    return <path key={pi} d={d} fill="none" stroke={wavelengthColor(pat.wavelengthNm)} strokeWidth={1.25} opacity={0.8} />
                  })}
                </g>
              )
            })}
          {/* Photons detected one at a time (Born rule) while playing — one
              path per colour instead of a DOM node per photon. */}
          {isLightSource &&
            photonPaths.map((pp, i) => (
              <path key={`ph-${i}`} d={pp.d} stroke={pp.color} strokeWidth={2.6} strokeLinecap="round" opacity={0.85} fill="none" />
            ))}
          {flyingPaths.map((pp, i) => (
            <g key={`fly-${i}`} fill="none" strokeLinecap="round">
              {/* thin dark rim so pale photons stay visible — no glow */}
              <path d={pp.d} strokeWidth={6.5} stroke={WARM_EDGE} opacity={0.7} />
              <path d={pp.d} strokeWidth={4.5} stroke={pp.color} />
            </g>
          ))}
        </g>
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2 - 1.5}
          ry={h / 2 - 1.5}
          fill={
            render === 'light-source'
              ? `url(#lamp-${object.id})`
              : render === 'charge'
                ? `color-mix(in oklch, ${chargeColor} 20%, var(--card))`
                : special
                  ? 'var(--card)'
                  : fill
          }
          stroke={render === 'charge' ? chargeColor : render === 'light-source' ? WARM_EDGE : stroke}
          strokeWidth={special || render === 'light-source' || render === 'charge' ? 2 : bodyStrokeWidth}
        />
        {render === 'light-source' && (
          <defs>
            <radialGradient id={`lamp-${object.id}`} cx="40%" cy="38%" r="70%">
              <stop offset="0%" stopColor="#fffdf3" />
              <stop offset="60%" stopColor={WARM_WHITE} />
              <stop offset="100%" stopColor="#ffdf85" />
            </radialGradient>
          </defs>
        )}
        {render === 'hinge' && (
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 6} fill="var(--foreground)" />
        )}
        {render === 'motor' && (
          <g stroke={stroke} strokeWidth={2}>
            <line x1={w / 2} y1={h / 2} x2={w / 2} y2={6} />
            <line x1={w / 2} y1={h / 2} x2={w - 8} y2={h * 0.72} />
            <line x1={w / 2} y1={h / 2} x2={8} y2={h * 0.72} />
          </g>
        )}
        {render === 'charge' && (
          <g stroke={chargeColor} strokeWidth={2.5} strokeLinecap="round">
            <line x1={w / 2 - 7} y1={h / 2} x2={w / 2 + 7} y2={h / 2} />
            {qVal >= 0 && <line x1={w / 2} y1={h / 2 - 7} x2={w / 2} y2={h / 2 + 7} />}
          </g>
        )}
        {isBody(object.behaviors) === 'dynamic' && !special && (
          // orientation tick so spin is visible
          <line x1={w / 2} y1={h / 2} x2={w - 4} y2={h / 2} stroke={stroke} strokeWidth={1.5} opacity={0.5} />
        )}
        {hasHeat && (
          <ellipse
            data-heat=""
            cx={w / 2}
            cy={h / 2}
            rx={w / 2 - 1.5}
            ry={h / 2 - 1.5}
            stroke="none"
            style={{ opacity: 0, transition: 'opacity 200ms linear' }}
          />
        )}
      </svg>
      <ShapeTextOverlay pageId={pageId} object={object} selected={selected} active={labelActive} autoEdit={editRequested} />
      </div>
    )
  }

  // rect
  return (
    <div className="relative h-full w-full" onDoubleClick={() => {
        // Shapes are "properties-then-edit": the FIRST double-click belongs to
        // the Properties panel (opened by the canvas wrapper). Only once that
        // has happened for this object does a double-click reach the label
        // editor. This handler fires BEFORE the wrapper's (child-to-parent
        // bubbling), so it has to ask the policy rather than be told.
        if (hasOpenedProperties(object.id)) setEditRequested(true)
      }}>
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label={object.name}>
      <rect x={1.5} y={1.5} width={w - 3} height={h - 3} rx={render === 'ground' ? 3 : cornerRadius} fill={fill} stroke={stroke} strokeWidth={bodyStrokeWidth} />
      {render === 'ground' && (
        <g stroke={stroke} strokeWidth={1} opacity={0.6}>
          {Array.from({ length: Math.max(2, Math.floor(w / 26)) }, (_, i) => (
            <line key={i} x1={10 + i * 26} y1={h - 3} x2={22 + i * 26} y2={3} />
          ))}
        </g>
      )}
      {hasHeat && (
        <rect
          data-heat=""
          x={1.5}
          y={1.5}
          width={w - 3}
          height={h - 3}
          rx={render === 'ground' ? 3 : cornerRadius}
          stroke="none"
          style={{ opacity: 0, transition: 'opacity 200ms linear' }}
        />
      )}
    </svg>
    <ShapeTextOverlay pageId={pageId} object={object} selected={selected} active={labelActive} autoEdit={editRequested} />
    </div>
  )
}

/**
 * A system boundary: a labeled region that OWNS its contents.
 *
 * It carries its own transport — Play / Pause / Step / Reset — that simulates
 * ONLY the objects inside it (lib/physics/world.ts buildWorld's `scopeId`),
 * so you can run one experiment on a page holding several. And the border is
 * absolute: the scoped world walls the box in, so nothing inside can ever
 * leave it, whatever forces are applied.
 */
function SystemBoundary({
  pageId,
  object,
  domain,
  color,
}: {
  pageId: string
  object: SceneObject
  domain: string
  color: string
}) {
  const mode = useRuntimeStore((s) => s.mode)
  const scopeId = useRuntimeStore((s) => s.scopeId)
  const mine = scopeId === object.id
  const running = mine && mode === 'running'
  const active = mine && mode !== 'edit'
  // Another system (or the page) is running — this one can't also run.
  const blocked = mode !== 'edit' && !mine

  const btn = (
    label: string,
    Icon: typeof Play,
    onClick: () => void,
    disabled = false,
    tint?: string
  ) => (
    <button
      key={label}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent disabled:opacity-30"
      style={{ color: tint ?? 'var(--muted-foreground)' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div
      className="h-full w-full rounded-2xl"
      style={{
        border: `1.5px ${active ? 'solid' : 'dashed'} ${color}`,
        background: `color-mix(in oklch, ${color} ${active ? 7 : 4}%, transparent)`,
        boxShadow: active ? `0 0 0 3px color-mix(in oklch, ${color} 18%, transparent)` : undefined,
      }}
      aria-label={object.name}
    >
      <span
        className="absolute -top-2.5 left-4 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ background: 'var(--background)', color, border: `1px solid ${color}` }}
      >
        {domain}
      </span>

      {/* Scoped transport — only this system's contents run. */}
      <div
        className="glass-strong absolute -top-4 right-4 flex items-center gap-0.5 rounded-lg p-0.5"
        style={{ border: `1px solid color-mix(in oklch, ${color} 40%, transparent)` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {running
          ? btn('Pause this system', Pause, () => pause(), false, color)
          : btn(
              blocked ? 'Another simulation is running' : 'Run only this system',
              Play,
              () => play(pageId, object.id),
              blocked,
              color
            )}
        {btn('Step this system forward', SkipForward, () => stepFrame(), !active || running)}
        {btn('Reset this system', RotateCcw, () => stop(), !active)}
      </div>
    </div>
  )
}
