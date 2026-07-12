'use client'

// Cash-flow diagram (engineering economics). A time rail with sharp arrows —
// up = inflow, down = outflow, height ∝ amount — styled like the Graph card
// (hairline grid, muted axis, mono labels). The spec (discrete investments,
// annuities, salvage, MARR) is edited in the Inspector, not here. Hovering
// the timeline drops a dashed marker showing the compounded value at that
// instant. Worth metrics (PW/FW/AW/IRR/CR/BC) sit above the diagram.

import { useMemo, useState } from 'react'
import { useDocStore } from '@/lib/store/document'
import {
  readSpec,
  expandFlows,
  metrics,
  valueAt,
  horizonOf,
  fmtMoney,
  fmtYear,
} from '@/lib/econ/engine'
import { getString, type ObjectRendererProps } from './types'

const IN = 'var(--chart-2)' // inflow  (up)
const OUT = 'var(--chart-5)' // outflow (down)

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="truncate text-[8.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-[11px] font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  )
}

export function CashflowObject({ pageId, object }: ObjectRendererProps) {
  const spec = useMemo(() => readSpec(getString(object, 'spec')), [object])
  const flows = useMemo(() => expandFlows(spec), [spec])
  const stats = useMemo(() => metrics(spec), [spec])
  const i = spec.marr / 100
  const N = horizonOf(spec)
  const [hoverT, setHoverT] = useState<number | null>(null)
  const selected = useDocStore((s) => s.selection.includes(object.id))

  // Diagram geometry (viewBox units; the SVG scales to the card).
  const W = 100
  const H = 100
  const padL = 5
  const padR = 4
  const axisY = 56
  const rail = W - padL - padR
  const xOf = (t: number) => padL + (rail * t) / N
  const maxAmt = Math.max(1, ...flows.map((f) => Math.abs(f.amount)))
  const upRoom = axisY - 14
  const dnRoom = H - axisY - 16
  const lenOf = (a: number) => (Math.abs(a) / maxAmt) * (a >= 0 ? upRoom : dnRoom)

  // Integer year ticks; fractional flows get their own light tick.
  const years = Array.from({ length: Math.floor(N) + 1 }, (_, k) => k)
  const hoverVal = hoverT === null ? 0 : valueAt(flows, i, hoverT)

  const posTone = stats.pw >= 0 ? IN : OUT

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      {/* header: name + description */}
      <div className="flex items-baseline gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="shrink-0 text-[11.5px] font-semibold text-muted-foreground">{object.name}</span>
        {spec.description && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">{spec.description}</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          MARR {spec.marr}%
        </span>
      </div>

      {/* worth metrics */}
      <div className="grid grid-cols-6 gap-2 border-b border-border/60 bg-accent/25 px-3 py-1">
        <Stat label="PW" value={fmtMoney(stats.pw)} tone={posTone} />
        <Stat label="FW" value={fmtMoney(stats.fw)} tone={posTone} />
        <Stat label="AW" value={fmtMoney(stats.aw)} tone={posTone} />
        <Stat label="IRR" value={stats.irr === null ? '—' : `${(stats.irr * 100).toFixed(1)}%`} />
        <Stat label="Cap. rec." value={fmtMoney(stats.cr)} />
        <Stat label="B/C" value={stats.bc === null ? '—' : stats.bc.toFixed(2)} />
      </div>

      {/* the diagram */}
      <div className="relative min-h-0 flex-1" onPointerDown={(e) => e.stopPropagation()}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const t = ((e.clientX - r.left) / r.width) * W
            const yr = ((t - padL) / rail) * N
            setHoverT(yr >= -0.02 && yr <= N + 0.02 ? Math.max(0, Math.min(N, yr)) : null)
          }}
          onPointerLeave={() => setHoverT(null)}
        >
          {/* year gridlines — same hairline language as the Graph card */}
          {years.map((y) => (
            <line
              key={`g${y}`}
              x1={xOf(y)}
              y1={6}
              x2={xOf(y)}
              y2={H - 10}
              stroke="var(--border)"
              strokeOpacity={0.5}
              strokeWidth={0.3}
            />
          ))}

          {/* the time rail */}
          <line x1={padL} y1={axisY} x2={W - padR} y2={axisY} stroke="var(--muted-foreground)" strokeWidth={0.5} />
          {years.map((y) => (
            <g key={y}>
              <line x1={xOf(y)} y1={axisY} x2={xOf(y)} y2={axisY + 2} stroke="var(--muted-foreground)" strokeWidth={0.4} />
              <text
                x={xOf(y)}
                y={axisY + 7}
                textAnchor="middle"
                fontSize={3.4}
                fill="var(--muted-foreground)"
                style={{ fontFamily: 'var(--font-mono, monospace)' }}
              >
                {y}
              </text>
            </g>
          ))}

          {/* flows — sharp single-weight arrows, filled triangular heads */}
          {flows.map((f) => {
            const up = f.amount >= 0
            const x = xOf(f.t)
            const len = lenOf(f.amount)
            const tip = up ? axisY - len : axisY + len
            const c = up ? IN : OUT
            const hw = 1.5 // head half-width
            const hl = 3 // head length
            const base = up ? tip + hl : tip - hl
            return (
              <g key={`${f.t}-${f.amount}`}>
                <line x1={x} y1={axisY} x2={x} y2={base} stroke={c} strokeWidth={0.7} />
                <path d={`M ${x - hw} ${base} L ${x} ${tip} L ${x + hw} ${base} Z`} fill={c} />
                <text
                  x={x}
                  y={up ? tip - 2 : tip + 4.2}
                  textAnchor="middle"
                  fontSize={3.4}
                  fontWeight={600}
                  fill={c}
                  style={{ fontFamily: 'var(--font-mono, monospace)' }}
                >
                  {fmtMoney(f.amount)}
                </text>
              </g>
            )
          })}

          {/* hover marker: dashed rule + compounded value at that instant */}
          {hoverT !== null && (
            <g>
              <line
                x1={xOf(hoverT)}
                y1={6}
                x2={xOf(hoverT)}
                y2={H - 10}
                stroke="var(--ring)"
                strokeWidth={0.4}
                strokeDasharray="1.5 1.2"
              />
              <circle cx={xOf(hoverT)} cy={axisY} r={0.9} fill="var(--ring)" />
            </g>
          )}
        </svg>

        {/* hover readout (HTML so the text never stretches with the viewBox) */}
        {hoverT !== null && (
          <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-md border border-border bg-card px-2 py-0.5 text-center font-mono text-[10px] shadow-sm">
            <span className="text-muted-foreground">t = {fmtYear(hoverT)} yr · </span>
            <span style={{ color: hoverVal >= 0 ? IN : OUT }}>{fmtMoney(hoverVal)}</span>
          </div>
        )}
      </div>

      {selected && (
        <p className="border-t border-border/60 py-1 text-center text-[10.5px] text-muted-foreground">
          Edit investments, annuities and MARR in the Inspector
        </p>
      )}
    </div>
  )
}
