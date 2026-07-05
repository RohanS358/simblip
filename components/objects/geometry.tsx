'use client'

// Geometry renderer: circles, rects, polygons, lines/connectors, ink strokes
// and schematic symbols. Styling reflects attached behaviors — a circle with
// a rigidBody reads as matter, a bare sketch reads as ink. Same object, the
// behavior is the difference (docs/architecture.md).

import { useMemo } from 'react'
import type { SceneObject } from '@/lib/scene/types'
import { isBody, connectorBehavior } from '@/lib/behaviors/registry'
import { connectorPath } from '@/lib/render/connector-path'
import { terminalsOf } from '@/lib/circuit/engine'
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
}

// Glow center per glowing symbol (viewBox coords).
const GLOW_POS: Record<string, { cx: number; cy: number; r: number }> = {
  led: { cx: 46, cy: 24, r: 16 },
  bulb: { cx: 48, cy: 24, r: 15 },
  output: { cx: 32, cy: 24, r: 15 },
}

// Body extents for variable-model symbols: where dynamic pin stubs stop on
// the left and start on the right (bottom stubs are vertical, into the body).
const STUB_EXTENTS: Record<string, { leftEnd: number; rightStart: number }> = {
  'and-gate': { leftEnd: 26, rightStart: 68 },
  'or-gate': { leftEnd: 24, rightStart: 68 },
  'xor-gate': { leftEnd: 21, rightStart: 72 },
  'nand-gate': { leftEnd: 22, rightStart: 72 },
  'nor-gate': { leftEnd: 20, rightStart: 68 },
  mux: { leftEnd: 30, rightStart: 64 },
  decoder: { leftEnd: 28, rightStart: 70 },
}

function SymbolGlyph({ obj }: { obj: SceneObject }) {
  const name = obj.geometry.symbol ?? ''
  const glyph = GLYPHS[name]
  const glow = GLOW_POS[name]
  const terminals = terminalsOf(obj)
  const stubExt = STUB_EXTENTS[name]
  // Pin stubs generated from the live terminal layout (glyph space 96×48).
  const stubPath = stubExt
    ? terminals
        .map((td) =>
          td.y === 1
            ? `M${(td.x * 96).toFixed(1)} 46 V34`
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
    return (
      <div
        className="h-full w-full rounded-2xl"
        style={{
          border: `1.5px dashed ${c}`,
          background: `color-mix(in oklch, ${c} 4%, transparent)`,
        }}
        aria-label={object.name}
      >
        <span
          className="absolute -top-2.5 left-4 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ background: 'var(--background)', color: c, border: `1px solid ${c}` }}
        >
          {domain}
        </span>
      </div>
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
    return (
      <svg width="100%" height="100%" className="overflow-visible" aria-label={object.name}>
        <path
          data-connector={connector ? '' : undefined}
          data-wire={flowable ? '' : undefined}
          d={d}
          fill="none"
          stroke={connector ? 'var(--accent-mint)' : isWire ? 'var(--accent-amber)' : stroke}
          strokeWidth={connector ? 2 : isBody(object.behaviors) ? 6 : isWire ? 2.5 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {flowOverlays(d)}
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
          data-wire={flowable ? '' : undefined}
          d={strokePath}
          fill={isBody(object.behaviors) ? fill : 'none'}
          stroke={isWire && !isBody(object.behaviors) ? 'var(--accent-amber)' : stroke}
          strokeWidth={isWire ? 2.5 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {flowOverlays(strokePath)}
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
