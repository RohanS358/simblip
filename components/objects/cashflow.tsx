'use client'

// Cash-flow timeline (engineering economics). Money is not a static arrow —
// it's a force acting on a time rail: green arrows push value up (inflows),
// red arrows pull down (outflows), height ∝ amount. Press Play and a
// playhead sweeps the horizon; each flow "grows" in as the playhead reaches
// it, a coin travels the rail compounding through the blue interest field,
// and NPV / FV update live. Edit `flows` as "period:amount; …".

import { useMemo, useState } from 'react'
import { Coins } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { useRuntimeStore } from '@/lib/physics/world'
import { parseFlows, npv, fv, balanceAt, irr, horizon, fmtMoney } from '@/lib/econ/engine'
import { getString, getNumber, type ObjectRendererProps } from './types'

export function CashflowObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const setParam = useDocStore((s) => s.setParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const [editing, setEditing] = useState(false)

  const flowsStr = getString(object, 'flows', '')
  const ratePct = getNumber(object, 'rate', 8)
  const i = ratePct / 100
  const flows = useMemo(() => parseFlows(flowsStr), [flowsStr])
  const N = Math.max(1, horizon(flows))

  // Runtime clock drives the sweep (freezes outside Play, like wave-source).
  const running = useRuntimeStore((s) => s.mode === 'running')
  const clock = useRuntimeStore((s) => s.time)
  const CYCLE = 6 // seconds to sweep the whole horizon
  const playhead = running ? ((clock % CYCLE) / CYCLE) * N : N // rest at full when stopped

  const stats = useMemo(
    () => ({ npv: npv(flows, i), fv: fv(flows, i), irr: irr(flows) }),
    [flows, i]
  )
  const maxAmt = Math.max(1, ...flows.map((f) => Math.abs(f.amount)))
  const balNow = balanceAt(flows, i, Math.floor(playhead))

  // Geometry of the drawing area.
  const w = object.size.w
  const h = object.size.h
  const padL = 40
  const padR = 16
  const axisY = h * 0.56
  const railW = w - padL - padR
  const xOf = (t: number) => padL + (railW * t) / N
  const maxBar = Math.min(axisY - 24, h - axisY - 30)
  const coinX = xOf(Math.min(playhead, N))

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Coins className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
        <span className="flex-1 truncate text-[11.5px] font-semibold text-muted-foreground">
          {object.name} · i = {ratePct}% / period
        </span>
        <span
          className="font-mono text-[11px] font-bold"
          style={{ color: stats.npv >= 0 ? 'var(--accent-mint)' : 'var(--accent-rose)' }}
          title="Net present value at t=0"
        >
          NPV {fmtMoney(stats.npv)}
        </span>
      </div>

      <div className="relative min-h-0 flex-1" onPointerDown={(e) => e.stopPropagation()}>
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h - 30}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={`cf-field-${object.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.10" />
              <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* interest field — a blue haze that has "passed" so far */}
          <rect x={padL} y={0} width={Math.max(0, coinX - padL)} height={h - 30} fill={`url(#cf-field-${object.id})`} />

          {/* the time rail */}
          <line x1={padL} y1={axisY} x2={w - padR} y2={axisY} stroke="var(--muted-foreground)" strokeWidth={1.5} />
          {Array.from({ length: N + 1 }, (_, t) => (
            <g key={t}>
              <line x1={xOf(t)} y1={axisY - 3} x2={xOf(t)} y2={axisY + 3} stroke="var(--muted-foreground)" strokeWidth={1} />
              <text x={xOf(t)} y={axisY + 15} textAnchor="middle" fontSize={8.5} fill="var(--muted-foreground)">
                {t}
              </text>
            </g>
          ))}

          {/* cash-flow arrows — grow in as the playhead reaches each period */}
          {flows.map((f, idx) => {
            const grow = Math.max(0, Math.min(1, playhead - f.t + 1))
            if (grow <= 0) return null
            const up = f.amount >= 0
            const full = (Math.abs(f.amount) / maxAmt) * maxBar
            const len = full * grow
            const x = xOf(f.t)
            const tipY = up ? axisY - len : axisY + len
            const color = up ? 'var(--accent-mint)' : 'var(--accent-rose)'
            const ah = 5
            return (
              <g key={idx}>
                <line x1={x} y1={axisY} x2={x} y2={tipY} stroke={color} strokeWidth={2.5} />
                <path
                  d={`M ${x - ah} ${tipY + (up ? ah : -ah)} L ${x} ${tipY} L ${x + ah} ${tipY + (up ? ah : -ah)} Z`}
                  fill={color}
                />
                {grow > 0.85 && (
                  <text
                    x={x}
                    y={up ? tipY - 5 : tipY + 12}
                    textAnchor="middle"
                    fontSize={8.5}
                    fontWeight={600}
                    fill={color}
                  >
                    {fmtMoney(f.amount)}
                  </text>
                )}
              </g>
            )
          })}

          {/* the traveling coin + its compounded balance */}
          {running && (
            <g>
              <circle cx={coinX} cy={axisY} r={6} fill="var(--accent-amber)" stroke="var(--background)" strokeWidth={1.5} />
              <text x={coinX} y={axisY - 10} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--accent-amber)">
                {fmtMoney(balNow)}
              </text>
            </g>
          )}
        </svg>

        {/* footer stats */}
        <div className="absolute bottom-1 left-0 right-0 flex items-center justify-center gap-3 font-mono text-[9.5px] text-muted-foreground">
          <span>FV(n={N}) {fmtMoney(stats.fv)}</span>
          <span>IRR {stats.irr === null ? '—' : `${(stats.irr * 100).toFixed(1)}%`}</span>
          <span className={stats.npv >= 0 ? 'text-[var(--accent-mint)]' : 'text-[var(--accent-rose)]'}>
            {stats.npv >= 0 ? '▲ accept' : '▼ reject'}
          </span>
        </div>
      </div>

      {/* editor row */}
      {editing ? (
        <div className="flex items-center gap-1 border-t border-border/60 p-1.5">
          <input
            autoFocus
            aria-label="Cash flows"
            className="min-w-0 flex-1 rounded bg-background/60 px-2 py-1 font-mono text-[11px] outline-none"
            defaultValue={flowsStr}
            placeholder="0:-1000; 1:300; 2:300"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              e.stopPropagation()
            }}
            onBlur={(e) => {
              if (e.target.value !== flowsStr) {
                pushHistory(pageId)
                setStringParam(pageId, object.id, 'flows', e.target.value)
              }
              setEditing(false)
            }}
          />
          <input
            aria-label="Interest rate percent"
            type="number"
            className="w-14 rounded bg-background/60 px-1.5 py-1 font-mono text-[11px] outline-none"
            defaultValue={ratePct}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              e.stopPropagation()
            }}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v !== ratePct) {
                pushHistory(pageId)
                setParam(pageId, object.id, 'rate', String(v))
              }
              setEditing(false)
            }}
          />
          <span className="pr-1 text-[10px] text-muted-foreground">%</span>
        </div>
      ) : (
        selected && (
          <button
            type="button"
            className="border-t border-border/60 py-1 text-center text-[10.5px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              pushHistory(pageId)
              setEditing(true)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            edit flows &amp; rate — Play to watch money move through time
          </button>
        )
      )}
    </div>
  )
}
