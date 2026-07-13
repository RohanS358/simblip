'use client'

// Geometry renderer: circles, rects, polygons, lines/connectors, ink strokes
// and schematic symbols. Styling reflects attached behaviors — a circle with
// a rigidBody reads as matter, a bare sketch reads as ink. Same object, the
// behavior is the difference (docs/architecture.md).

import { useEffect, useMemo, useState } from 'react'
import type { SceneObject } from '@/lib/scene/types'
import { isBody, connectorBehavior } from '@/lib/behaviors/registry'
import { connectorPath } from '@/lib/render/connector-path'
import { terminalsOf } from '@/lib/circuit/engine'
import { inkPath } from './ink'
import { getNumber, type ObjectRendererProps } from './types'
import {
  traceRays,
  screenPatterns,
  samplePhoton,
  wavelengthColor,
  opticParam,
  type ScreenPattern,
} from '@/lib/optics/engine'
import { useDocStore } from '@/lib/store/document'
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
  lineInputImpedance,
  lineReflectionCoefficient,
  voltageEnvelope,
  type Medium,
} from '@/lib/waves/engine'
import { psi, energyLevel, transmissionCoefficient as quantumTransmission } from '@/lib/quantum/engine'

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

function bodyFill(obj: SceneObject): { fill: string; stroke: string } {
  const kind = isBody(obj.behaviors)
  if (kind === 'dynamic')
    return {
      fill: 'color-mix(in oklch, var(--accent-blue) 22%, var(--card))',
      stroke: 'var(--accent-blue)',
    }
  if (kind === 'static')
    return {
      fill: 'color-mix(in oklch, var(--muted-foreground) 18%, var(--card))',
      stroke: 'var(--muted-foreground)',
    }
  return { fill: 'transparent', stroke: 'var(--foreground)' }
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

function SymbolGlyph({ obj }: { obj: SceneObject }) {
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
  const digital = obj.geometry.domain === 'digital'
  const firstParam = Object.entries(obj.parameters).find(
    ([n, p]) => p.kind === 'number' && n !== 'inputs'
  )
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
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
  const { w, h } = object.size
  const { fill, stroke } = bodyFill(object)
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
  // (real single/double-slit physics at 1 px = 1 µm — lib/optics/engine.ts).
  const patterns = useMemo(() => {
    if (!isLightSource || !pageObjects) return []
    return screenPatterns(Object.values(pageObjects))
  }, [isLightSource, pageObjects])

  // Quantum layer: while the transport runs, photons land one by one at
  // Born-rule positions — the pattern builds up from individual detections.
  const playMode = useRuntimeStore((s) => (isLightSource ? s.mode : 'edit'))
  const [photons, setPhotons] = useState<{ s: number; t: number; j: number }[]>([])
  useEffect(() => {
    if (!isLightSource) return
    if (playMode !== 'running' || patterns.length === 0) {
      if (playMode === 'edit') setPhotons([])
      return
    }
    const timer = setInterval(() => {
      setPhotons((prev) => {
        if (prev.length >= 1400) return prev
        const next = [...prev]
        for (let i = 0; i < 6; i++) {
          const s = Math.floor(Math.random() * patterns.length)
          next.push({ s, t: samplePhoton(patterns[s]), j: (Math.random() - 0.5) * 8 })
        }
        return next
      })
    }, 60)
    return () => clearInterval(timer)
  }, [isLightSource, playMode, patterns])

  // Wave source is the one new-domain object that animates continuously
  // (a traveling-wave snapshot) — it reads the runtime clock and freezes
  // outside Play, same rule the physics tracers already follow. The
  // conditional inside the selector (not around the hook) keeps every
  // OTHER object's render from being retriggered by the clock ticking.
  const isWaveSource = render === 'wave-source'
  const waveTime = useRuntimeStore((s) => (isWaveSource ? s.time : 0))

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
    () => (bareInk && points ? inkPath(points, { size: inkSize }) : ''),
    [bareInk, points, inkSize]
  )

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
    const wt = 2 * Math.PI * f * waveTime
    const len = 260
    const samples = 70
    const path = Array.from({ length: samples }, (_, i) => {
      const x = (i / (samples - 1)) * len
      const y = waveInstant(E0, beta, alpha, x, wt)
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')
    const cx0 = w / 2
    const cy0 = h / 2
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label={object.name}>
        <g transform={`translate(${cx0} ${cy0})`}>
          <line x1={0} y1={0} x2={len} y2={0} stroke="var(--accent-violet)" strokeWidth={1} opacity={0.2} strokeDasharray="2 4" />
          <path d={path} fill="none" stroke="var(--accent-violet)" strokeWidth={1.75} opacity={0.9} />
        </g>
        <ellipse cx={cx0} cy={cy0} rx={w / 2 - 1.5} ry={h / 2 - 1.5} fill="var(--accent-violet)" stroke="var(--foreground)" strokeWidth={2} />
        <text x={cx0} y={h + 13} textAnchor="middle" fontSize="9.5" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
          {`α=${alpha.toFixed(3)} β=${beta.toFixed(3)}`}
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
    const L = Math.max(0.01, opticParam(object, 'quantumWell', 'L', 1))
    const En = energyLevel(n, L)
    const padX = 16
    const padTop = 26
    const plotW = Math.max(10, w - padX * 2 - 46)
    const plotH = Math.max(10, h - padTop - 14)
    const baseY = padTop + plotH
    const samples = 60
    const psiMax = Math.sqrt(2 / L) || 1
    const psiScale = (plotH / 2 - 2) / psiMax
    const probScale = (plotH - 4) / (psiMax * psiMax)
    const pts = Array.from({ length: samples }, (_, i) => {
      const x = (i / (samples - 1)) * L
      const px = padX + (i / (samples - 1)) * plotW
      return { px, v: psi(n, L, x) }
    })
    const psiPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px} ${baseY - plotH / 2 - p.v * psiScale}`).join(' ')
    const probPath =
      `M ${padX} ${baseY} ` +
      pts.map((p) => `L ${p.px} ${baseY - p.v * p.v * probScale}`).join(' ') +
      ` L ${padX + plotW} ${baseY} Z`
    const ladderLevels = Math.min(5, Math.max(3, n + 2))
    const ladderMaxE = energyLevel(ladderLevels, L) || 1
    const ladderX = padX + plotW + 14
    const ladderW = 26
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible" aria-label={object.name}>
        <rect x={1.5} y={1.5} width={w - 3} height={h - 3} rx={8} fill="transparent" stroke="var(--foreground)" strokeWidth={2} />
        <line x1={padX} y1={baseY} x2={padX + plotW} y2={baseY} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.4} />
        <path d={probPath} fill="color-mix(in oklch, var(--accent-mint) 30%, transparent)" stroke="var(--accent-mint)" strokeWidth={1} />
        <path d={psiPath} fill="none" stroke="var(--accent-violet)" strokeWidth={1.75} />
        {Array.from({ length: ladderLevels }, (_, i) => {
          const level = i + 1
          const e = energyLevel(level, L)
          const y = baseY - (e / ladderMaxE) * plotH
          const active = level === n
          return (
            <g key={level}>
              <line
                x1={ladderX}
                y1={y}
                x2={ladderX + ladderW}
                y2={y}
                stroke={active ? 'var(--accent-violet)' : 'var(--muted-foreground)'}
                strokeWidth={active ? 2.5 : 1.5}
                opacity={active ? 1 : 0.5}
              />
              <text x={ladderX + ladderW + 3} y={y + 3} fontSize="8" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
                {level}
              </text>
            </g>
          )
        })}
        <text x={padX} y={14} fontSize="10" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
          {`n=${n}  L=${L}  Eₙ=${En.toFixed(2)}`}
        </text>
      </svg>
    )
  }

  // Tunnel barrier: rectangular barrier V0/L for a particle of energy E —
  // incident/reflected/transmitted amplitude schematic, T/R read directly
  // off the closed-form transmission coefficient (lib/quantum/engine.ts).
  if (render === 'tunnel-barrier') {
    const E = opticParam(object, 'tunnelBarrier', 'E', 0.5)
    const V0 = opticParam(object, 'tunnelBarrier', 'V0', 1)
    const L = Math.max(0.01, opticParam(object, 'tunnelBarrier', 'L', 1))
    const T = quantumTransmission(E, V0, L)
    const R = 1 - T
    const padX = 16
    const padTop = 26
    const plotW = w - padX * 2
    const plotH = h - padTop - 30
    const baseY = padTop + plotH
    const barrierX0 = padX + plotW * 0.4
    const barrierX1 = padX + plotW * 0.6
    const eY = baseY - (Math.min(E, V0 * 1.4) / (V0 * 1.4 || 1)) * plotH
    const v0Y = baseY - plotH
    const waveSeg = (x0: number, x1: number, amp: number, cycles: number, phase = 0) => {
      const n = 40
      let d = ''
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const x = x0 + (x1 - x0) * t
        const y = eY - amp * Math.sin(cycles * Math.PI * 2 * t + phase)
        d += `${i === 0 ? 'M' : 'L'} ${x} ${y} `
      }
      return d
    }
    const ampIncident = 16
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible" aria-label={object.name}>
        <rect x={1.5} y={1.5} width={w - 3} height={h - 3} rx={8} fill="transparent" stroke="var(--foreground)" strokeWidth={2} />
        <line x1={padX} y1={baseY} x2={padX + plotW} y2={baseY} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.4} />
        <rect
          x={barrierX0}
          y={v0Y}
          width={barrierX1 - barrierX0}
          height={baseY - v0Y}
          fill="color-mix(in oklch, var(--accent-rose) 22%, transparent)"
          stroke="var(--accent-rose)"
          strokeWidth={1.5}
        />
        <line x1={padX} y1={eY} x2={padX + plotW} y2={eY} stroke="var(--accent-amber)" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={waveSeg(padX, barrierX0, ampIncident, 3)} fill="none" stroke="var(--accent-violet)" strokeWidth={1.75} />
        <path
          d={waveSeg(padX, barrierX0, ampIncident * Math.sqrt(R), 3, Math.PI)}
          fill="none"
          stroke="var(--accent-blue)"
          strokeWidth={1.25}
          opacity={0.6}
        />
        <path d={waveSeg(barrierX1, padX + plotW, ampIncident * Math.sqrt(T), 3)} fill="none" stroke="var(--accent-mint)" strokeWidth={1.75} />
        <text x={padX} y={14} fontSize="10" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
          {`E=${E}  V0=${V0}  L=${L}`}
        </text>
        <text x={padX} y={h - 6} fontSize="10" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
          {`T=${T.toFixed(3)}  R=${R.toFixed(3)}`}
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
    const d = connectorPath(render, a[0], a[1], b[0], b[1])
    const OPTICS_STYLE: Record<string, { color: string; width: number }> = {
      lens: { color: 'var(--accent-violet)', width: 3 },
      mirror: { color: 'var(--accent-blue)', width: 4 },
      'optical-screen': { color: 'var(--muted-foreground)', width: 5 },
      slit: { color: 'var(--accent-amber)', width: 3 },
      'wave-boundary': { color: 'var(--accent-rose)', width: 3 },
      'transmission-line': { color: 'var(--accent-mint)', width: 3 },
    }
    const optics = render ? OPTICS_STYLE[render] : undefined
    // Attachment dots: mark where a connector/wire meets whatever it touches,
    // in the same color as the line itself.
    const endColor = connector ? 'var(--accent-mint)' : isWire ? 'var(--accent-amber)' : undefined
    return (
      <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
        <path
          data-connector={connector ? '' : undefined}
          data-wire={flowable ? '' : undefined}
          d={d}
          fill="none"
          stroke={optics ? optics.color : connector ? 'var(--accent-mint)' : isWire ? 'var(--accent-amber)' : stroke}
          strokeWidth={optics ? optics.width : connector ? 2 : isBody(object.behaviors) ? 6 : isWire ? 2.5 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {render === 'lens' && (
          <g stroke={optics!.color} strokeWidth={2} fill="none">
            <path d={`M${a[0] - 8} ${a[1] + 10} L${a[0]} ${a[1]} L${a[0] - 8} ${a[1] - 10}`} />
            <path d={`M${b[0] - 8} ${b[1] + 10} L${b[0]} ${b[1]} L${b[0] - 8} ${b[1] - 10}`} />
          </g>
        )}
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
              const gap = opticParam(object, 'slit', 'gap', 20)
              const count = Math.max(1, Math.min(2, Math.round(opticParam(object, 'slit', 'count', 1))))
              const spacing = opticParam(object, 'slit', 'spacing', 60)
              const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
              const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
              const ux = (b[0] - a[0]) / len
              const uy = (b[1] - a[1]) / len
              const centers = count === 2 ? [-spacing / 2, spacing / 2] : [0]
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
            const ux = (b[0] - a[0]) / segLen
            const uy = (b[1] - a[1]) / segLen
            const nx = -uy
            const ny = ux
            const half = Math.min(50, segLen / 2)
            const N = 24
            const env1 = voltageEnvelope(gamma, pc1.beta * half, N)
            const tauAbs = cAbs(tau)
            const env2 = Array.from({ length: N }, (_, i) => tauAbs * Math.exp(-pc2.alpha * (i / (N - 1)) * half))
            const amp = 12
            const path1 = env1
              .map((v, i) => {
                const t = -half * (i / (N - 1))
                const x = mid.x + ux * t + nx * v * amp
                const y = mid.y + uy * t + ny * v * amp
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
              })
              .join(' ')
            const path2 = env2
              .map((v, i) => {
                const t = half * (i / (N - 1))
                const x = mid.x + ux * t + nx * v * amp
                const y = mid.y + uy * t + ny * v * amp
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
              })
              .join(' ')
            const gArgDeg = (cArg(gamma) * 180) / Math.PI
            return (
              <g>
                <path d={path1} fill="none" stroke="var(--accent-rose)" strokeWidth={1.5} opacity={0.85} />
                <path d={path2} fill="none" stroke="var(--accent-mint)" strokeWidth={1.5} opacity={0.85} />
                <text x={mid.x + 6} y={mid.y - 8} fontSize="9" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
                  {`Γ=${gAbs.toFixed(2)}∠${gArgDeg.toFixed(0)}° SWR=${s.toFixed(2)} τ=${tauAbs.toFixed(2)}`}
                </text>
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
            const path = env
              .map((v, i) => {
                const t = half - (i / (N - 1)) * segLen
                const x = mid.x + ux * t + nx * v * amp
                const y = mid.y + uy * t + ny * v * amp
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
              })
              .join(' ')
            return (
              <g>
                <path d={path} fill="none" stroke="var(--accent-mint)" strokeWidth={1.5} opacity={0.85} />
                <text x={mid.x} y={mid.y - 10} textAnchor="middle" fontSize="9" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
                  {`Zin=${zin.re.toFixed(0)}${zin.im >= 0 ? '+' : ''}${zin.im.toFixed(0)}j  Γ=${gAbs.toFixed(2)}  SWR=${s.toFixed(2)}`}
                </text>
              </g>
            )
          })()}
        {flowOverlays(d)}
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
            stroke={isWire && !isBody(object.behaviors) ? 'var(--accent-amber)' : stroke}
            strokeWidth={isWire ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {flowOverlays(strokePath)}
        {showEnds && (
          <>
            <circle cx={strokePts[0][0]} cy={strokePts[0][1]} r={3.5} fill="var(--accent-amber)" />
            <circle
              cx={strokePts[strokePts.length - 1][0]}
              cy={strokePts[strokePts.length - 1][1]}
              r={3.5}
              fill="var(--accent-amber)"
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
      <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
        <path d={d} fill={fill} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      </svg>
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
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label={object.name}>
        {/* Rays are traced in world space (rotation already baked into the
            beam direction); counter-rotate so the container's rotate()
            transform doesn't double-apply it. */}
        <g transform={object.rotation ? `rotate(${-object.rotation} ${w / 2} ${h / 2})` : undefined}>
          {myRays.map((r, i) => (
            <path
              key={i}
              d={`M ${r.points.map((p) => `${p.x - object.position.x} ${p.y - object.position.y}`).join(' L ')}`}
              fill="none"
              stroke={wavelengthColor(r.wavelengthNm)}
              strokeWidth={1.5}
              opacity={0.85}
            />
          ))}
          {myRays.map(
            (r, i) =>
              r.hitScreen && (
                <circle
                  key={`hit-${i}`}
                  cx={r.hitScreen.x - object.position.x}
                  cy={r.hitScreen.y - object.position.y}
                  r={3}
                  fill={wavelengthColor(r.wavelengthNm)}
                />
              )
          )}
          {/* Interference: fringe band on the screen + |A|² intensity curve. */}
          {isLightSource &&
            patterns.map((pat: ScreenPattern, pi: number) => {
              const ox = object.position.x
              const oy = object.position.y
              const n = pat.intensity.length
              const dx = (pat.b.x - pat.a.x) / (n - 1)
              const dy = (pat.b.y - pat.a.y) / (n - 1)
              const len = Math.hypot(pat.b.x - pat.a.x, pat.b.y - pat.a.y) || 1
              // outward normal of the screen line, curve drawn on that side
              const nx = -(pat.b.y - pat.a.y) / len
              const ny = (pat.b.x - pat.a.x) / len
              const CURVE = 46
              const color = wavelengthColor(pat.wavelengthNm)
              const curve = pat.intensity
                .map((I, i) => {
                  const px = pat.a.x + dx * i + nx * I * CURVE - ox
                  const py = pat.a.y + dy * i + ny * I * CURVE - oy
                  return `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`
                })
                .join(' ')
              return (
                <g key={`pat-${pi}`}>
                  {pat.intensity.map((I, i) =>
                    I > 0.02 ? (
                      <line
                        key={i}
                        x1={pat.a.x + dx * i - ox}
                        y1={pat.a.y + dy * i - oy}
                        x2={pat.a.x + dx * i + nx * 10 - ox}
                        y2={pat.a.y + dy * i + ny * 10 - oy}
                        stroke={color}
                        strokeWidth={len / n + 0.5}
                        opacity={I * 0.9}
                      />
                    ) : null
                  )}
                  <path d={curve} fill="none" stroke={color} strokeWidth={1.5} opacity={0.8} />
                  {/* Photons detected one at a time (Born rule) while playing. */}
                  {photons
                    .filter((p) => p.s === pi)
                    .map((p, i) => (
                      <circle
                        key={`ph-${i}`}
                        cx={pat.a.x + (pat.b.x - pat.a.x) * p.t + nx * (12 + p.j) - ox}
                        cy={pat.a.y + (pat.b.y - pat.a.y) * p.t + ny * (12 + p.j) - oy}
                        r={1.3}
                        fill={color}
                        opacity={0.85}
                      />
                    ))}
                </g>
              )
            })}
        </g>
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2 - 1.5}
          ry={h / 2 - 1.5}
          fill={
            render === 'light-source'
              ? 'var(--accent-amber)'
              : render === 'charge'
                ? `color-mix(in oklch, ${chargeColor} 20%, var(--card))`
                : special
                  ? 'var(--card)'
                  : fill
          }
          stroke={render === 'charge' ? chargeColor : stroke}
          strokeWidth={2}
        />
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
    )
  }

  // rect
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label={object.name}>
      <rect x={1.5} y={1.5} width={w - 3} height={h - 3} rx={render === 'ground' ? 3 : 8} fill={fill} stroke={stroke} strokeWidth={2} />
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
          rx={render === 'ground' ? 3 : 8}
          stroke="none"
          style={{ opacity: 0, transition: 'opacity 200ms linear' }}
        />
      )}
    </svg>
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
