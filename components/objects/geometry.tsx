'use client'

// Geometry renderer: circles, rects, polygons, lines/connectors, ink strokes
// and schematic symbols. Styling reflects attached behaviors — a circle with
// a rigidBody reads as matter, a bare sketch reads as ink. Same object, the
// behavior is the difference (docs/architecture.md).

import { useMemo } from 'react'
import type { SceneObject } from '@/lib/scene/types'
import { isBody, connectorBehavior } from '@/lib/behaviors/registry'
import { connectorPath } from '@/lib/render/connector-path'
import type { ObjectRendererProps } from './types'

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
  bjt: (
    <>
      <circle cx="48" cy="24" r="18" fill="none" />
      <path d="M40 12 v24 M40 20 l16 -12 M40 28 l16 12 M4 24 h36 M56 8 v-4 M56 40 v4" />
    </>
  ),
  mosfet: <path d="M4 24 h28 M36 12 v24 M44 10 v8 M44 20 v8 M44 30 v8 M44 14 h24 v-8 M44 34 h24 v8 M44 24 h16" />,
  opamp: <path d="M24 6 v36 l48 -18 z M8 15 h16 M8 33 h16 M72 24 h16 M29 15 h6 M32 12 v6 M29 33 h6" />,
  'and-gate': <path d="M24 8 h28 a16 16 0 0 1 0 32 h-28 z M4 16 h20 M4 32 h20 M68 24 h24" fill="none" />,
  'or-gate': (
    <path d="M20 8 q14 16 0 32 q30 0 48 -16 q-18 -16 -48 -16 z M4 16 h22 M4 32 h22 M68 24 h24" fill="none" />
  ),
  'xor-gate': (
    <path d="M26 8 q14 16 0 32 q30 0 46 -16 q-16 -16 -46 -16 z M18 8 q14 16 0 32 M4 16 h18 M4 32 h18 M72 24 h20" fill="none" />
  ),
  'not-gate': <path d="M28 8 v32 l36 -16 z M64 24 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M4 24 h24 M72 24 h20" fill="none" />,
}

function SymbolGlyph({ obj }: { obj: SceneObject }) {
  const name = obj.geometry.symbol ?? ''
  const glyph = GLYPHS[name]
  const firstParam = Object.entries(obj.parameters).find(([, p]) => p.kind === 'number')
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
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
    </div>
  )
}

export function GeometryObject({ object, selected }: ObjectRendererProps) {
  const { kind, points } = object.geometry
  const { w, h } = object.size
  const { fill, stroke } = bodyFill(object)
  const render = object.metadata.render as string | undefined
  const connector = connectorBehavior(object.behaviors)

  const strokePath = useMemo(
    () => (kind === 'stroke' && points ? pointsToPath(points) : ''),
    [kind, points]
  )

  if (kind === 'symbol') return <SymbolGlyph obj={object} />

  if (kind === 'line') {
    const pts = points ?? [[0, 0], [w, 0]]
    const a = pts[0]
    const b = pts[pts.length - 1]
    return (
      <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
        <path
          data-connector={connector ? '' : undefined}
          d={connectorPath(render, a[0], a[1], b[0], b[1])}
          fill="none"
          stroke={connector ? 'var(--accent-mint)' : stroke}
          strokeWidth={connector ? 2 : isBody(object.behaviors) ? 6 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
    return (
      <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
        <path
          d={strokePath}
          fill={isBody(object.behaviors) ? fill : 'none'}
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
    const special = render === 'hinge' || render === 'motor'
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} aria-label={object.name}>
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1.5} ry={h / 2 - 1.5} fill={special ? 'var(--card)' : fill} stroke={stroke} strokeWidth={2} />
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
        {isBody(object.behaviors) === 'dynamic' && !special && (
          // orientation tick so spin is visible
          <line x1={w / 2} y1={h / 2} x2={w - 4} y2={h / 2} stroke={stroke} strokeWidth={1.5} opacity={0.5} />
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
    </svg>
  )
}
