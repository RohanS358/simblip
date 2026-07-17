'use client'

// Graph object. Plots live simulation channels from ONE OR MORE source
// objects AND user formulas (full expressions against the page scope +
// sample channels), with customizable axes, scales and reference lines.
// Series are stored as "objectId:channel" pairs in the `series` string
// param (";"-separated); legacy `sourceId` + `yChannels` params are still
// honored. With no series bound, formulas plot over the x range, so it
// doubles as a function plotter.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, Activity, TrendingUp, Sigma } from 'lucide-react'
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
  Customized,
} from 'recharts'
import { subscribe, readBuffer, decimate } from '@/lib/physics/bus'
import { compileExpr, evalExpr, type Scope } from '@/lib/formula/engine'
import { derivativeExpr } from '@/lib/formula/steps'
import { fmtNum } from '@/lib/scene/format'
import { usePrefs } from '@/lib/store/preferences'
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

export interface ChannelStats {
  mean: number
  rms: number
  peak: number
  pp: number
  freq: number
  period: number
}

/** Oscilloscope-style measurements over the plotted window: RMS, average,
 * peak-to-peak and a zero-crossing frequency/period estimate. */
export function computeStats(rows: Record<string, number>[], key: string, xChannel: string): ChannelStats | null {
  const pts = rows
    .map((r) => ({ x: r[xChannel], v: r[key] }))
    .filter((p): p is { x: number; v: number } => Number.isFinite(p.x) && Number.isFinite(p.v))
  if (pts.length < 2) return null
  const n = pts.length
  const vals = pts.map((p) => p.v)
  const mean = vals.reduce((a, b) => a + b, 0) / n
  const rms = Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / n)
  const peak = Math.max(...vals.map(Math.abs))
  const pp = Math.max(...vals) - Math.min(...vals)
  let crossings = 0
  for (let i = 1; i < n; i++) if ((vals[i - 1] - mean) * (vals[i] - mean) < 0) crossings++
  const span = pts[n - 1].x - pts[0].x
  const freq = span > 0 ? crossings / 2 / span : 0
  return { mean, rms, peak, pp, freq, period: freq > 0 ? 1 / freq : 0 }
}

/** Every readout on the card honours the Math settings (precision, notation,
 *  degrees vs radians) — one dial for the whole app. */
const fmtMeas = (v: number): string => fmtNum(v)

// ── Calculus overlay ────────────────────────────────────────────────────────
// Plotting f' or ∫f as extra LINES wastes the chart — you get a curve with no
// stated meaning. Instead the derivative draws the TANGENT at the point you
// hover (with its slope) and the integral SHADES the region it measures (with
// its value). Both read the plotted rows, so they work for live channels and
// formulas alike.

/** Central-difference slope of one series at x, from the plotted samples. */
function slopeAt(rows: Record<string, number>[], key: string, xKey: string, x: number): number {
  const pts = rows
    .map((r) => ({ x: r[xKey], y: r[key] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (pts.length < 2) return NaN
  let i = 0
  for (let k = 1; k < pts.length; k++) if (Math.abs(pts[k].x - x) < Math.abs(pts[i].x - x)) i = k
  const a = pts[Math.max(0, i - 1)]
  const b = pts[Math.min(pts.length - 1, i + 1)]
  return b.x === a.x ? NaN : (b.y - a.y) / (b.x - a.x)
}

/** Value of a series at x (nearest sample). */
function valueAt(rows: Record<string, number>[], key: string, xKey: string, x: number): number {
  let best = NaN
  let bd = Infinity
  for (const r of rows) {
    const d = Math.abs(r[xKey] - x)
    if (Number.isFinite(r[key]) && d < bd) {
      bd = d
      best = r[key]
    }
  }
  return best
}

/** Trapezoidal ∫ over [a,b]. axis 'x' → ∫y dx (area to the x-axis);
 *  axis 'y' → ∫x dy (area to the y-axis). */
function integrate(
  rows: Record<string, number>[],
  key: string,
  xKey: string,
  a: number,
  b: number,
  axis: 'x' | 'y'
): number {
  const pts = rows
    .map((r) => ({ x: r[xKey], y: r[key] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= a && p.x <= b)
    .sort((p, q) => p.x - q.x)
  let sum = 0
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const q = pts[i]
    sum +=
      axis === 'x'
        ? ((p.y + q.y) / 2) * (q.x - p.x) // ∫ y dx
        : ((p.x + q.x) / 2) * (q.y - p.y) // ∫ x dy
  }
  return sum
}

interface OverlayProps {
  rows: Record<string, number>[]
  panels: { key: string; name: string; color: string }[]
  xKey: string
  deriv: boolean
  integ: boolean
  axis: 'x' | 'y'
  a: number
  b: number
  hoverX: number | null
  // injected by recharts
  xAxisMap?: Record<string, { scale: (v: number) => number }>
  yAxisMap?: Record<string, { scale: (v: number) => number }>
}

/** One SVG layer for both features — recharts hands us the axis scales, so we
 *  can draw in data space (a tangent is a line segment, not a series). */
function CalculusLayer(props: OverlayProps) {
  const { rows, panels, xKey, deriv, integ, axis, a, b, hoverX, xAxisMap, yAxisMap } = props
  const xs = xAxisMap ? Object.values(xAxisMap)[0]?.scale : undefined
  const ys = yAxisMap ? Object.values(yAxisMap)[0]?.scale : undefined
  if (!xs || !ys) return null

  return (
    <g style={{ pointerEvents: 'none' }}>
      {integ &&
        panels.map((p) => {
          const band = rows
            .filter((r) => r[xKey] >= a && r[xKey] <= b && Number.isFinite(r[p.key]))
            .sort((m1, m2) => m1[xKey] - m2[xKey])
          if (band.length < 2) return null
          // Fill to the chosen axis: down to y=0, or across to x=0.
          const curve = band.map((r) => `${xs(r[xKey])},${ys(r[p.key])}`)
          const back =
            axis === 'x'
              ? [`${xs(band[band.length - 1][xKey])},${ys(0)}`, `${xs(band[0][xKey])},${ys(0)}`]
              : [`${xs(0)},${ys(band[band.length - 1][p.key])}`, `${xs(0)},${ys(band[0][p.key])}`]
          return (
            <polygon
              key={`i-${p.key}`}
              points={[...curve, ...back].join(' ')}
              fill={p.color}
              fillOpacity={0.16}
              stroke={p.color}
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          )
        })}

      {deriv &&
        hoverX !== null &&
        panels.map((p) => {
          const y = valueAt(rows, p.key, xKey, hoverX)
          const mSlope = slopeAt(rows, p.key, xKey, hoverX)
          if (!Number.isFinite(y) || !Number.isFinite(mSlope)) return null
          // A tangent drawn over a fixed span of the x-domain reads clearly at
          // any zoom, unlike one drawn over a fixed pixel length.
          const span = (b - a) * 0.14 || 1
          const x1 = hoverX - span
          const x2 = hoverX + span
          return (
            <g key={`d-${p.key}`}>
              <line
                x1={xs(x1)}
                y1={ys(y - mSlope * span)}
                x2={xs(x2)}
                y2={ys(y + mSlope * span)}
                stroke={p.color}
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
              <circle cx={xs(hoverX)} cy={ys(y)} r={3} fill={p.color} />
            </g>
          )
        })}
    </g>
  )
}

export function GraphObject({ pageId, object }: ObjectRendererProps) {
  const xChannel = getString(object, 'xChannel', 't') || 't'
  const formulasStr = getString(object, 'formulas')
  const stacked = getString(object, 'stacked') === '1'
  const measuring = getString(object, 'measure') === '1'
  const deriv = getString(object, 'deriv') === '1'
  const integ = getString(object, 'integ') === '1'
  const integAxis: 'x' | 'y' = getString(object, 'integAxis') === 'y' ? 'y' : 'x'
  const [hoverX, setHoverX] = useState<number | null>(null)
  usePrefs((s) => s.math) // re-render when precision/notation changes
  const scope = useDocStore((s) => s.scopes[pageId]) ?? {}
  const pageObjects = useDocStore((s) => s.pages[pageId]?.objects)
  const setStringParam = useDocStore((s) => s.setStringParam)

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
  // Bare key when plotting the primary source keeps phase plots (x = a
  // channel) and legacy docs rendering.
  const seriesKeyOf = (s: GraphSeries) =>
    s.objectId === primaryId && !multiSource ? s.channel : `${s.objectId}:${s.channel}`

  // One descriptor per plotted line — the combined chart and the stacked
  // small-multiples view render the same panels.
  const panels = [
    ...series.map((s, i) => ({
      key: seriesKeyOf(s),
      name: seriesLabel(s),
      color: GRAPH_COLORS[i % GRAPH_COLORS.length],
      dash: undefined as string | undefined,
      // Logic-probe/output channels are square waves — step rendering shows
      // clean clock edges instead of interpolated slopes.
      step: s.channel === 'level' || s.channel === 'value',
    })),
    ...formulas.map((f, i) => ({
      key: `f${i}`,
      name: f.expr,
      color: GRAPH_COLORS[(series.length + i) % GRAPH_COLORS.length],
      dash: sourceIds.length > 0 ? '6 3' : undefined,
      step: false,
    })),
  ]

  const hasPlot = rows.length > 1 && panels.length > 0
  const useStacked = stacked && panels.length > 1
  const stats = useMemo(
    () => (measuring && panels[0] ? computeStats(rows, panels[0].key, xChannel) : null),
    [measuring, rows, panels, xChannel]
  )

  // Integration bounds default to the plotted window, so it works out of the
  // box; integA/integB override either end.
  const dataMinX = rows.length ? Math.min(...rows.map((r) => r[xChannel])) : 0
  const dataMaxX = rows.length ? Math.max(...rows.map((r) => r[xChannel])) : 1
  const intA = bound(getString(object, 'integA'), scope) ?? xMin ?? dataMinX
  const intB = bound(getString(object, 'integB'), scope) ?? xMax ?? dataMaxX

  const integrals = useMemo(
    () =>
      integ && hasPlot
        ? panels.map((p) => ({
            ...p,
            value: integrate(rows, p.key, xChannel, intA, intB, integAxis),
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [integ, hasPlot, rows, panels.map((p) => p.key).join(','), xChannel, intA, intB, integAxis]
  )

  // Slopes at the hovered x, plus the SYMBOLIC derivative for formula series.
  const slopes = useMemo(
    () =>
      deriv && hoverX !== null && hasPlot
        ? panels.map((p, i) => {
            const f = formulas[i - series.length]
            return {
              ...p,
              slope: slopeAt(rows, p.key, xChannel, hoverX),
              expr: f ? derivativeExpr(f.expr, xChannel) : null,
            }
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deriv, hoverX, hasPlot, rows, panels.map((p) => p.key).join(','), xChannel]
  )

  const tooltipProps = {
    isAnimationActive: false,
    cursor: { stroke: 'var(--ring)', strokeWidth: 1, strokeDasharray: '3 3' },
    labelFormatter: (v: number | string) => `${xChannel} = ${Number(v).toFixed(3)}`,
    formatter: (value: number | string) => Number(value).toPrecision(4),
    contentStyle: {
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontSize: 10.5,
      fontFamily: 'var(--font-mono, monospace)',
      padding: '4px 8px',
    },
    labelStyle: { color: 'var(--muted-foreground)', marginBottom: 2 },
  } as const

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {panels.map((p) => p.name).join(', ') || 'Graph'}
          {hasPlot ? ` vs ${xChannel}` : ''}
        </span>
        {panels.length > 0 && (
          <button
            type="button"
            aria-label={measuring ? 'Hide measurements' : 'Show measurements (RMS, avg, peak, frequency)'}
            aria-pressed={measuring}
            title={measuring ? 'Hide measurements' : 'Oscilloscope readouts for the first series'}
            className={
              measuring
                ? 'rounded p-0.5 text-[var(--accent-amber)]'
                : 'rounded p-0.5 text-muted-foreground hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'measure', measuring ? '' : '1')}
          >
            <Activity className="h-3.5 w-3.5" />
          </button>
        )}
        {panels.length > 0 && (
          <button
            type="button"
            aria-label={deriv ? 'Hide tangent' : 'Show tangent on hover (derivative)'}
            aria-pressed={deriv}
            title={deriv ? 'Derivative: off' : 'Derivative — hover to see the tangent and its slope'}
            className={
              deriv
                ? 'rounded p-0.5 text-[var(--accent-mint)]'
                : 'rounded p-0.5 text-muted-foreground hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'deriv', deriv ? '' : '1')}
          >
            <TrendingUp className="h-3.5 w-3.5" />
          </button>
        )}
        {panels.length > 0 && (
          <button
            type="button"
            aria-label={integ ? 'Hide area' : 'Shade the area under the curve (integral)'}
            aria-pressed={integ}
            title={integ ? 'Integral: off' : 'Integral — shade the region and show its value'}
            className={
              integ
                ? 'rounded p-0.5 text-[var(--accent-violet)]'
                : 'rounded p-0.5 text-muted-foreground hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'integ', integ ? '' : '1')}
          >
            <Sigma className="h-3.5 w-3.5" />
          </button>
        )}
        {integ && (
          <button
            type="button"
            aria-label={`Integrate to the ${integAxis}-axis`}
            title={`Integrating to the ${integAxis}-axis — click to swap`}
            className="rounded px-1 font-mono text-[10px] text-[var(--accent-violet)]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() =>
              setStringParam(pageId, object.id, 'integAxis', integAxis === 'x' ? 'y' : 'x')
            }
          >
            d{integAxis}
          </button>
        )}
        {panels.length > 1 && (
          <button
            type="button"
            aria-label={stacked ? 'Combine into one chart' : 'Split into stacked charts'}
            aria-pressed={stacked}
            title={stacked ? 'Combined view' : 'Stacked view — one mini chart per series'}
            className={
              stacked
                ? 'rounded p-0.5 text-[var(--accent-blue)]'
                : 'rounded p-0.5 text-muted-foreground hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'stacked', stacked ? '' : '1')}
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {stats && (
        <div
          className="grid grid-cols-5 gap-1 border-b border-border/60 bg-accent/30 px-2 py-1 font-mono text-[9.5px] text-muted-foreground"
          aria-label="Channel measurements"
        >
          <span>RMS {fmtMeas(stats.rms)}</span>
          <span>Avg {fmtMeas(stats.mean)}</span>
          <span>Pk-Pk {fmtMeas(stats.pp)}</span>
          <span>Freq {fmtMeas(stats.freq)}</span>
          <span>T {fmtMeas(stats.period)}</span>
        </div>
      )}
      {deriv && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border/60 bg-accent/20 px-2 py-1 font-mono text-[9.5px]">
          {hoverX === null ? (
            <span className="text-muted-foreground">Hover the chart to place the tangent…</span>
          ) : (
            slopes.map((sl) => (
              <span key={sl.key} style={{ color: sl.color }}>
                d{sl.name}/d{xChannel} = {fmtMeas(sl.slope)}
                {sl.expr ? <span className="opacity-70"> · {sl.expr}</span> : null}
              </span>
            ))
          )}
        </div>
      )}
      {integ && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border/60 bg-accent/20 px-2 py-1 font-mono text-[9.5px]">
          <span className="text-muted-foreground">
            ∫ over {fmtMeas(intA)}…{fmtMeas(intB)} d{integAxis}
          </span>
          {integrals.map((it) => (
            <span key={it.key} style={{ color: it.color }}>
              {it.name} = {fmtMeas(it.value)}
            </span>
          ))}
        </div>
      )}
      {hasPlot && useStacked ? (
        // Small multiples: one mini chart per series, shared X domain and a
        // synced tooltip cursor so values line up vertically for comparison.
        <div className="flex min-h-0 flex-1 flex-col p-1 text-[10px]" onPointerDown={(e) => e.stopPropagation()}>
          {panels.map((p, i) => (
            <div key={p.key} className="relative min-h-0 flex-1">
              <span
                className="absolute right-2 top-0 z-10 font-mono text-[9.5px] font-semibold"
                style={{ color: p.color }}
              >
                {p.name}
              </span>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} syncId={`graph-${object.id}`} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis
                    dataKey={xChannel}
                    type="number"
                    domain={[xMin ?? 'dataMin', xMax ?? 'dataMax']}
                    allowDataOverflow
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={9}
                    tick={i === panels.length - 1}
                    height={i === panels.length - 1 ? 22 : 4}
                  />
                  <YAxis
                    type="number"
                    domain={[yMin ?? 'auto', yMax ?? 'auto']}
                    allowDataOverflow
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={9}
                    width={46}
                    // Short minis (3+ stacked) cull recharts' default 5 ticks
                    // down to nothing — 3 ticks with the ends pinned always fit.
                    tickCount={3}
                    interval="preserveStartEnd"
                  />
                  <Tooltip {...tooltipProps} />
                  {refYs.map((v, j) => (
                    <ReferenceLine key={`ry${j}`} y={v} stroke="var(--accent-rose)" strokeDasharray="5 4" />
                  ))}
                  {refXs.map((v, j) => (
                    <ReferenceLine key={`rx${j}`} x={v} stroke="var(--accent-rose)" strokeDasharray="5 4" />
                  ))}
                  <Line
                    type={p.step ? 'stepAfter' : 'monotone'}
                    dataKey={p.key}
                    name={p.name}
                    stroke={p.color}
                    strokeWidth={1.8}
                    strokeDasharray={p.dash}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      ) : hasPlot ? (
        <div className="relative min-h-0 flex-1 p-1 text-[10px]" onPointerDown={(e) => e.stopPropagation()}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              margin={{ top: 8, right: 12, bottom: 0, left: -14 }}
              onMouseMove={(st: { activeLabel?: string | number }) => {
                if (!deriv) return
                const v = Number(st?.activeLabel)
                setHoverX(Number.isFinite(v) ? v : null)
              }}
              onMouseLeave={() => setHoverX(null)}
            >
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
              <Tooltip {...tooltipProps} />
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
              {panels.map((p) => (
                <Line
                  key={p.key}
                  type={p.step ? 'stepAfter' : 'monotone'}
                  dataKey={p.key}
                  name={p.name}
                  stroke={p.color}
                  strokeWidth={1.8}
                  strokeDasharray={p.dash}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
              {(deriv || integ) && (
                <Customized
                  component={(cp: object) => (
                    <CalculusLayer
                      {...(cp as OverlayProps)}
                      rows={rows}
                      panels={panels}
                      xKey={xChannel}
                      deriv={deriv}
                      integ={integ}
                      axis={integAxis}
                      a={intA}
                      b={intB}
                      hoverX={hoverX}
                    />
                  )}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
          {/* The total sits in the middle of the shaded region, where it reads. */}
          {integ && integrals.length > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5">
              {integrals.map((it) => (
                <span
                  key={it.key}
                  className="rounded-md border border-border bg-card/90 px-1.5 py-0.5 font-mono text-[11px] font-bold shadow-sm"
                  style={{ color: it.color }}
                >
                  ∫ {it.name} = {fmtMeas(it.value)}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
          {series.length > 0
            ? 'Run the bound simulation to see live data.'
            : 'Add a series in the Inspector — or type a formula (e.g. sin(t), derivative(sin(t), t), integral(sin(u), u, 0, t)) to plot it.'}
        </div>
      )}
    </div>
  )
}
