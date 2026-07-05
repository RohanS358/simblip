'use client'

// Graph object. Plots live simulation channels from ONE OR MORE source
// objects AND user formulas (full expressions against the page scope +
// sample channels), with customizable axes, scales and reference lines.
// Series are stored as "objectId:channel" pairs in the `series` string
// param (";"-separated); legacy `sourceId` + `yChannels` params are still
// honored. With no series bound, formulas plot over the x range, so it
// doubles as a function plotter.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { subscribe, readBuffer, decimate } from '@/lib/physics/bus'
import { compileExpr, evalExpr, type Scope } from '@/lib/formula/engine'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'

export const GRAPH_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]
const MAX_POINTS = 300
const MIN_FRAME_MS = 80 // ≤ ~12 Hz chart repaint; the bus updates far faster

const splitList = (s: string) =>
  s
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)

export interface GraphSeries {
  objectId: string
  channel: string
}

/** Parse the `series` param, falling back to legacy sourceId+yChannels. */
export function parseSeries(object: ObjectRendererProps['object']): GraphSeries[] {
  const raw = splitList(getString(object, 'series'))
  if (raw.length > 0) {
    return raw
      .map((entry) => {
        const i = entry.indexOf(':')
        if (i <= 0) return null
        return { objectId: entry.slice(0, i), channel: entry.slice(i + 1) }
      })
      .filter((s): s is GraphSeries => s !== null && s.channel.length > 0)
  }
  // Legacy format: one source, comma/semicolon-separated channels.
  const sourceId = getString(object, 'sourceId')
  if (!sourceId) return []
  const channels = getString(object, 'yChannels')
    .split(/[,;]/)
    .map((c) => c.trim())
    .filter(Boolean)
  const chs = channels.length > 0 ? channels : (readBuffer(sourceId)?.channelNames.slice(0, 2) ?? [])
  return chs.map((channel) => ({ objectId: sourceId, channel }))
}

/** Bound expression → number, or undefined for auto. */
function bound(expr: string, scope: Scope): number | undefined {
  if (!expr.trim()) return undefined
  const { value, error } = evalExpr(expr, scope, NaN)
  return error || !Number.isFinite(value) ? undefined : value
}

export function GraphObject({ pageId, object }: ObjectRendererProps) {
  const xChannel = getString(object, 'xChannel', 't') || 't'
  const formulasStr = getString(object, 'formulas')
  const scope = useDocStore((s) => s.scopes[pageId]) ?? {}
  const pageObjects = useDocStore((s) => s.pages[pageId]?.objects)

  const seriesKey = getString(object, 'series') + '|' + getString(object, 'sourceId') + '|' + getString(object, 'yChannels')
  const series = useMemo(() => parseSeries(object), [seriesKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const sourceIds = useMemo(() => [...new Set(series.map((s) => s.objectId))], [series])
  const primaryId = sourceIds[0] ?? ''

  const formulas = useMemo(
    () => splitList(formulasStr).map((expr) => ({ expr, fn: compileExpr(expr, NaN) })),
    [formulasStr]
  )

  const xMin = bound(getString(object, 'xMin'), scope)
  const xMax = bound(getString(object, 'xMax'), scope)
  const yMin = bound(getString(object, 'yMin'), scope)
  const yMax = bound(getString(object, 'yMax'), scope)
  const refYs = splitList(getString(object, 'refY'))
    .map((e) => bound(e, scope))
    .filter((v): v is number => v !== undefined)
  const refXs = splitList(getString(object, 'refX'))
    .map((e) => bound(e, scope))
    .filter((v): v is number => v !== undefined)

  const [data, setData] = useState<Record<string, number>[]>([])
  const lastPaint = useRef(0)

  useEffect(() => {
    if (sourceIds.length === 0) {
      setData([])
      return
    }
    const pull = () => {
      const now = performance.now()
      if (now - lastPaint.current < MIN_FRAME_MS) return
      lastPaint.current = now
      // Merge every source's samples into rows keyed by (rounded) time.
      // Physics pushes all objects on the same tick, so timestamps align.
      const merged = new Map<number, Record<string, number>>()
      for (const id of sourceIds) {
        const buf = readBuffer(id)
        if (!buf) continue
        for (const s of decimate(buf.samples, MAX_POINTS)) {
          const t = Number(s.t.toFixed(3))
          let row = merged.get(t)
          if (!row) {
            row = { t }
            merged.set(t, row)
          }
          for (const [ch, v] of Object.entries(s.channels)) {
            row[`${id}:${ch}`] = v
            // Primary source also exposes bare channel names so the x-axis
            // picker and formulas keep working like the single-source days.
            if (id === primaryId) row[ch] = v
          }
        }
      }
      setData([...merged.values()].sort((a, b) => a.t - b.t))
    }
    pull()
    const unsubs = sourceIds.map((id) => subscribe(id, pull))
    return () => unsubs.forEach((u) => u())
  }, [sourceIds, primaryId, xChannel])

  // Final rows: live samples enriched with formula columns — or, with no
  // source, a pure function plot across the x range.
  const rows = useMemo(() => {
    if (sourceIds.length > 0) {
      if (formulas.length === 0) return data
      return data.map((row) => {
        const s = { ...scope, ...row }
        const out: Record<string, number> = { ...row }
        formulas.forEach((f, i) => (out[`f${i}`] = f.fn(s)))
        return out
      })
    }
    if (formulas.length === 0) return []
    const x0 = xMin ?? 0
    const x1 = xMax ?? 10
    if (!(x1 > x0)) return []
    const N = 240
    return Array.from({ length: N + 1 }, (_, i) => {
      const x = x0 + ((x1 - x0) * i) / N
      const s = { ...scope, [xChannel]: x, t: x }
      const out: Record<string, number> = { [xChannel]: Number(x.toFixed(4)) }
      formulas.forEach((f, j) => (out[`f${j}`] = f.fn(s)))
      return out
    })
  }, [sourceIds, data, formulas, scope, xMin, xMax, xChannel])

  const multiSource = sourceIds.length > 1
  const nameOf = (id: string) => pageObjects?.[id]?.name ?? '?'
  const seriesLabel = (s: GraphSeries) => (multiSource ? `${nameOf(s.objectId)} · ${s.channel}` : s.channel)

  const hasPlot = rows.length > 1 && (series.length > 0 || formulas.length > 0)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      <div className="border-b border-border/60 px-3 py-1.5">
        <span className="text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {[...series.map(seriesLabel), ...formulas.map((f) => f.expr)].join(', ') || 'Graph'}
          {hasPlot ? ` vs ${xChannel}` : ''}
        </span>
      </div>
      {hasPlot ? (
        <div className="min-h-0 flex-1 p-1 text-[10px]" onPointerDown={(e) => e.stopPropagation()}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
              <XAxis
                dataKey={xChannel}
                type="number"
                domain={[xMin ?? 'dataMin', xMax ?? 'dataMax']}
                allowDataOverflow
                stroke="var(--muted-foreground)"
                tickLine={false}
                axisLine={false}
                fontSize={10}
              />
              <YAxis
                type="number"
                domain={[yMin ?? 'auto', yMax ?? 'auto']}
                allowDataOverflow
                stroke="var(--muted-foreground)"
                tickLine={false}
                axisLine={false}
                fontSize={10}
                width={46}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: 'var(--ring)', strokeWidth: 1, strokeDasharray: '3 3' }}
                labelFormatter={(v) => `${xChannel} = ${Number(v).toFixed(3)}`}
                formatter={(value: number | string) => Number(value).toPrecision(4)}
                contentStyle={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 10.5,
                  fontFamily: 'var(--font-mono, monospace)',
                  padding: '4px 8px',
                }}
                labelStyle={{ color: 'var(--muted-foreground)', marginBottom: 2 }}
              />
              <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
              {refYs.map((v, i) => (
                <ReferenceLine
                  key={`ry${i}`}
                  y={v}
                  stroke="var(--accent-rose)"
                  strokeDasharray="5 4"
                  label={{ value: String(v), fontSize: 9, fill: 'var(--accent-rose)', position: 'right' }}
                />
              ))}
              {refXs.map((v, i) => (
                <ReferenceLine
                  key={`rx${i}`}
                  x={v}
                  stroke="var(--accent-rose)"
                  strokeDasharray="5 4"
                  label={{ value: String(v), fontSize: 9, fill: 'var(--accent-rose)', position: 'top' }}
                />
              ))}
              {series.map((s, i) => (
                <Line
                  key={`${s.objectId}:${s.channel}`}
                  type="monotone"
                  dataKey={
                    // Bare key when plotting the primary source keeps phase
                    // plots (x = a channel) and legacy docs rendering.
                    s.objectId === primaryId && !multiSource ? s.channel : `${s.objectId}:${s.channel}`
                  }
                  name={seriesLabel(s)}
                  stroke={GRAPH_COLORS[i % GRAPH_COLORS.length]}
                  strokeWidth={1.8}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
              {formulas.map((f, i) => (
                <Line
                  key={`f${i}`}
                  type="monotone"
                  dataKey={`f${i}`}
                  name={f.expr}
                  stroke={GRAPH_COLORS[(series.length + i) % GRAPH_COLORS.length]}
                  strokeWidth={1.8}
                  strokeDasharray={sourceIds.length > 0 ? '6 3' : undefined}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
          {series.length > 0
            ? 'Run the bound simulation to see live data.'
            : 'Add a series in the Inspector — or type a formula (e.g. sin(t)) to plot it.'}
        </div>
      )}
    </div>
  )
}
