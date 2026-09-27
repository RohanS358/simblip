'use client'

// Graph object. Plots live simulation channels from ONE OR MORE source
// objects AND user formulas (full expressions against the page scope +
// sample channels), with customizable axes, scales and reference lines.
// Series are stored as "objectId:channel" pairs in the `series` string
// param (";"-separated); legacy `sourceId` + `yChannels` params are still
// honored. With no series bound, formulas plot over the x range, so it
// doubles as a function plotter.

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Layers, Activity, TrendingUp, Sigma, Box, X, Maximize, TableProperties, Table2 } from 'lucide-react'
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
import { compileExprChecked, evalExpr, type Scope } from '@/lib/formula/engine'
import { sampleFunctions, autoYDomain, parseEntry, niceTicks, niceDomain, niceStep, fmtTick } from '@/lib/formula/plot-sample'
import { derivativeExpr } from '@/lib/formula/steps'
import { fmtNum } from '@/lib/scene/format'
import { usePrefs } from '@/lib/store/preferences'
import { useDocStore } from '@/lib/store/document'
import { parseBindings, type Binding } from '@/lib/scene/bindings'
import { parseHeaders, parseData, evalTable, serializeHeaders, serializeData } from '@/lib/scene/table-data'
import { createGeometry } from '@/lib/scene/factory'
import { str } from '@/lib/scene/types'
import { ProbeButtons } from './probe-buttons'
import { getString, type ObjectRendererProps } from './types'

// Stable empty scope reference — see components/objects/table.tsx.
const EMPTY_SCOPE: Scope = Object.freeze({}) as Scope

// three.js only loads once a graph object actually switches to 3D view.
const Graph3D = dynamic(() => import('./graph-3d').then((m) => m.Graph3D), { ssr: false })

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

/** A graph series is just a binding — one object's one channel. */
export type GraphSeries = Binding

/** Parse the `series` param, falling back to legacy sourceId+yChannels. */
export function parseSeries(object: ObjectRendererProps['object']): GraphSeries[] {
  const bound = parseBindings(getString(object, 'series'))
  if (bound.length > 0) return bound
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
  let lo = Infinity
  let hi = -Infinity
  for (const v of vals) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const peak = Math.max(Math.abs(lo), Math.abs(hi))
  const pp = hi - lo
  // Frequency from the first to the last mean-crossing, each located by
  // linear interpolation — counting crossings over the whole window was off
  // by up to half a cycle at the window edges.
  const tc: number[] = []
  for (let i = 1; i < n; i++) {
    const a = vals[i - 1] - mean
    const b = vals[i] - mean
    if (a * b < 0) tc.push(pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * a) / (a - b))
  }
  const freq = tc.length >= 3 ? (tc.length - 1) / 2 / (tc[tc.length - 1] - tc[0]) : 0
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

type Domain = [number, number]
type View = { x: Domain; y: Domain }
interface AxisScale {
  (v: number): number
  domain(): number[]
  invert?: (px: number) => number
}

/** Invisible recharts layer that hands the live axis scales to pan/zoom. */
function ScaleProbe(props: {
  onScales: (x: AxisScale, y: AxisScale) => void
  xAxisMap?: Record<string, { scale: AxisScale }>
  yAxisMap?: Record<string, { scale: AxisScale }>
}) {
  const xs = props.xAxisMap ? Object.values(props.xAxisMap)[0]?.scale : undefined
  const ys = props.yAxisMap ? Object.values(props.yAxisMap)[0]?.scale : undefined
  if (xs && ys) props.onScales(xs, ys)
  return null
}

const usesVar = (expr: string, v: string) => new RegExp(`\\b${v}\\b`).test(expr)

export function GraphObject({ pageId, object, selected }: ObjectRendererProps) {
  const formulasStr = getString(object, 'formulas')
  const entries = useMemo(() => splitList(formulasStr).map((raw) => ({ raw, e: parseEntry(raw) })), [formulasStr])
  const hasSeries = getString(object, 'series') !== '' || getString(object, 'sourceId') !== ''
  // A linked Table (its Plot button sets tableId): first column is x.
  const tableId = getString(object, 'tableId')
  const tableObj = useDocStore((s) => (tableId ? s.pages[pageId]?.objects[tableId] : undefined))
  const tableCols = useMemo(
    () => (tableObj?.geometry.kind === 'table' ? parseHeaders(getString(tableObj, 'headers', 'A;B;C')) : []),
    [tableObj]
  )
  const xParam =
    getString(object, 'xChannel') ||
    (!hasSeries && tableCols.length > 1 && !entries.some(({ e }) => e.kind === 'fn') ? tableCols[0].name : 't')
  // A pure function plot written in x (y = x²) gets an x axis, not "t".
  const xChannel =
    !hasSeries &&
    xParam === 't' &&
    entries.some(({ e }) => e.kind === 'fn' && usesVar(e.expr, 'x')) &&
    !entries.some(({ e }) => e.kind === 'fn' && usesVar(e.expr, 't'))
      ? 'x'
      : xParam
  const stacked = getString(object, 'stacked') === '1'
  const view: '2d' | '3d' = getString(object, 'view') === '3d' ? '3d' : '2d'
  const measuring = getString(object, 'measure') === '1'
  const deriv = getString(object, 'deriv') === '1'
  const integ = getString(object, 'integ') === '1'
  const integAxis: 'x' | 'y' = getString(object, 'integAxis') === 'y' ? 'y' : 'x'
  const [hoverX, setHoverX] = useState<number | null>(null)
  usePrefs((s) => s.math) // re-render when precision/notation changes
  const scope = useDocStore((s) => s.scopes[pageId] ?? EMPTY_SCOPE)
  const pageObjects = useDocStore((s) => s.pages[pageId]?.objects)
  const setStringParam = useDocStore((s) => s.setStringParam)

  const seriesKey = getString(object, 'series') + '|' + getString(object, 'sourceId') + '|' + getString(object, 'yChannels')
  const series = useMemo(() => parseSeries(object), [seriesKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const sourceIds = useMemo(() => [...new Set(series.map((s) => s.objectId))], [series])
  const primaryId = sourceIds[0] ?? ''

  const formulas = useMemo(
    // Checked, not compileExpr: that one holds the last good value on a
    // domain error, which drew flat fake lines where f is undefined.
    () =>
      entries.flatMap(({ raw, e }) =>
        e.kind === 'fn' ? [{ expr: e.expr, name: raw, fn: compileExprChecked(e.expr) }] : []
      ),
    [entries]
  )

  // Pan/zoom viewport — local, like a calculator: double-click (or the reset
  // button) returns to the Inspector's ranges.
  const [vp, setVp] = useState<View | null>(null)
  /** true mid-gesture/animation: sample coarsely and hide the tooltip */
  const [moving, setMoving] = useState(false)
  const xMinP = bound(getString(object, 'xMin'), scope)
  const xMaxP = bound(getString(object, 'xMax'), scope)
  const yMinP = bound(getString(object, 'yMin'), scope)
  const yMaxP = bound(getString(object, 'yMax'), scope)
  const defaultX0 = xChannel === 't' ? 0 : -10
  const xMin = vp?.x[0] ?? xMinP
  const xMax = vp?.x[1] ?? xMaxP
  const yMin = vp?.y[0] ?? yMinP
  const yMax = vp?.y[1] ?? yMaxP
  const refYs = splitList(getString(object, 'refY'))
    .map((e) => bound(e, scope))
    .filter((v): v is number => v !== undefined)
  const refXs = [
    ...splitList(getString(object, 'refX')),
    ...entries.flatMap(({ e }) => (e.kind === 'vline' ? [e.expr] : [])),
  ]
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
        const plotted = [...series.filter((sr) => sr.objectId === id).map((sr) => sr.channel), xChannel]
        for (const s of decimate(buf.samples, MAX_POINTS, plotted)) {
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
  }, [sourceIds, primaryId, xChannel, series])

  // Final rows: live samples enriched with formula columns — or, with no
  // source, a pure function plot across the x range.
  // A missing key (not NaN) is what makes recharts leave a gap.
  const { rows, uniform } = useMemo(() => {
    if (sourceIds.length > 0) {
      if (formulas.length === 0) return { rows: data, uniform: null }
      return {
        rows: data.map((row) => {
          const s = { ...scope, ...row }
          const out: Record<string, number> = { ...row }
          formulas.forEach((f, i) => {
            const v = f.fn(s).value
            if (Number.isFinite(v)) out[`f${i}`] = v
          })
          return out
        }),
        uniform: null,
      }
    }
    if (formulas.length === 0) return { rows: [], uniform: null }
    const x0 = xMin ?? defaultX0
    const x1 = xMax ?? 10
    if (!(x1 > x0)) return { rows: [], uniform: null }
    // One mutable scope for thousands of evaluations instead of a copy each.
    const s: Scope = { ...scope }
    const fns = formulas.map((f) => (x: number) => {
      s[xChannel] = x
      s.t = x
      s.x = x
      return f.fn(s).value
    })
    const sampled = sampleFunctions(fns, x0, x1, moving ? 1 : undefined)
    return {
      rows: sampled.rows.map((r) => {
        const out: Record<string, number> = { [xChannel]: r.x }
        r.ys.forEach((y, j) => {
          if (Number.isFinite(y)) out[`f${j}`] = y
        })
        return out
      }),
      uniform: sampled.uniform,
    }
  }, [sourceIds, data, formulas, scope, xMin, xMax, xChannel, moving, defaultX0])

  // Points and parametric curves carry their own x values, so each gets its
  // own row set (recharts Lines accept per-line data).
  const extras = useMemo(() => {
    const out: { key: string; name: string; points: boolean; line: boolean; data: Record<string, number>[] }[] = []
    entries.forEach(({ raw, e }, i) => {
      const key = `e${i}`
      if (e.kind === 'points') {
        const data = e.pts.flatMap(([xs, ys]) => {
          const x = bound(xs, scope)
          const y = bound(ys, scope)
          return x !== undefined && y !== undefined ? [{ [xChannel]: x, [key]: y }] : []
        })
        out.push({ key, name: raw, points: true, line: false, data })
      } else if (e.kind === 'param') {
        const t0 = bound(e.t0, scope) ?? 0
        const t1 = bound(e.t1, scope) ?? 2 * Math.PI
        const fx = compileExprChecked(e.x)
        const fy = compileExprChecked(e.y)
        const s: Scope = { ...scope }
        const data: Record<string, number>[] = []
        // ponytail: fixed 600 samples, adaptive like sampleFunctions if tight curves look faceted
        for (let k = 0; k <= 600 && t1 > t0; k++) {
          s.t = t0 + ((t1 - t0) * k) / 600
          const x = fx(s).value
          const y = fy(s).value
          if (Number.isFinite(x) && Number.isFinite(y)) data.push({ [xChannel]: x, [key]: y })
        }
        out.push({ key, name: raw, points: false, line: true, data })
      }
    })
    if (tableObj && tableCols.length > 1) {
      const cells = evalTable(tableCols, parseData(getString(tableObj, 'data'), tableCols.length), scope)
      tableCols.slice(1).forEach((c, j) => {
        const key = `tb${j}`
        const data = cells
          .filter((row) => Number.isFinite(row[0].value) && Number.isFinite(row[j + 1].value))
          .map((row) => ({ [xChannel]: row[0].value, [key]: row[j + 1].value }))
          .sort((a, b) => a[xChannel] - b[xChannel])
        out.push({ key, name: `${tableObj.name} · ${c.name}`, points: true, line: true, data })
      })
    }
    return out
  }, [entries, scope, xChannel, tableObj, tableCols])

  // Pin this run (UX masterplan §14): a frozen A/B trace overlaid dimmed
  // behind the live one, keyed and merged the same way `data` above is.
  const pinnedRun = useDocStore((s) => s.pinnedRuns[pageId])
  const pinnedRows = useMemo(() => {
    if (!pinnedRun || sourceIds.length === 0) return []
    const merged = new Map<number, Record<string, number>>()
    for (const id of sourceIds) {
      const samples = pinnedRun.samples[id]
      if (!samples) continue
      for (const s of decimate(samples, MAX_POINTS)) {
        const t = Number(s.t.toFixed(3))
        let row = merged.get(t)
        if (!row) {
          row = { t }
          merged.set(t, row)
        }
        for (const [ch, v] of Object.entries(s.channels)) {
          row[`${id}:${ch}`] = v
          if (id === primaryId) row[ch] = v
        }
      }
    }
    return [...merged.values()].sort((a, b) => a.t - b.t)
  }, [pinnedRun, sourceIds, primaryId])

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
      formula: false,
    })),
    ...formulas.map((f, i) => ({
      key: `f${i}`,
      name: f.name,
      color: GRAPH_COLORS[(series.length + i) % GRAPH_COLORS.length],
      dash: sourceIds.length > 0 ? '6 3' : undefined,
      step: false,
      formula: true,
    })),
  ]

  const hasPlot = (rows.length > 1 && panels.length > 0) || extras.some((e) => e.data.length > 0)
  const extraColor = (i: number) => GRAPH_COLORS[(panels.length + i) % GRAPH_COLORS.length]
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggleHidden = (key: string) =>
    setHidden((h) => {
      const n = new Set(h)
      if (!n.delete(key)) n.add(key)
      return n
    })

  // Auto y-range that isn't hijacked by an asymptote (tan x would otherwise
  // squash every other feature flat against ±10¹⁵). Explicit yMin/yMax win.
  const autoY = useMemo(() => {
    if (yMinP !== undefined && yMaxP !== undefined) return null
    if (uniform) return autoYDomain(uniform)
    const vals: number[] = []
    for (const r of rows) for (const p of panels) if (Number.isFinite(r[p.key])) vals.push(r[p.key])
    return autoYDomain(vals)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, uniform, yMinP, yMaxP, panels.map((p) => p.key).join(',')])
  const yDomain: [number | string, number | string] = [yMinP ?? autoY?.[0] ?? 'auto', yMaxP ?? autoY?.[1] ?? 'auto']

  // ── Home view ── the numeric window shown when not zoomed. Computed here
  // (not left to recharts' 'auto') so ticks are round, 0 is findable, and
  // pan/zoom animate between real numbers.
  // Live data: nobody knows the future values, so the window must adapt — but
  // refitting every repaint is what made it jitter. Instead the range only
  // GROWS during a run (like a scope's auto-range) and the time axis extends
  // in whole tick steps ahead of the trace. A new run (t going backwards) or
  // Reset view starts fresh.
  const sticky = useRef<{ x: Domain; y: Domain; lastT: number } | null>(null)
  const tickCount = { x: Math.max(3, Math.round(object.size.w / 75)), y: Math.max(3, Math.round(object.size.h / 55)) }
  const homeView = useMemo((): View => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    const see = (r: Record<string, number>, key: string) => {
      const x = r[xChannel]
      const y = r[key]
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    for (const p of panels) if (!hidden.has(p.key)) for (const r of rows) see(r, p.key)
    for (const e of extras) if (!hidden.has(e.key)) for (const r of e.data) see(r, e.key)
    const formulaOnly = sourceIds.length === 0 && formulas.length > 0
    let x: Domain = formulaOnly ? [defaultX0, 10] : [x0, x1]
    // Points/curves alone get breathing room; a live time axis stays exact.
    if (!formulaOnly && rows.length === 0 && x1 >= x0) {
      const pad = (x1 - x0) * 0.08 || 1
      x = niceDomain(x0 - pad, x1 + pad, tickCount.x)
    }
    if (!(x[1] > x[0])) x = Number.isFinite(x[0]) ? [x[0] - 1, x[0] + 1] : [0, 1]
    let y: Domain = autoY ?? [y0, y1]
    if (!(y[1] >= y[0])) y = [-1, 1]
    const pad = (y[1] - y[0]) * 0.06 || 1
    y = niceDomain(y[0] - pad, y[1] + pad, tickCount.y)
    const lastT = rows[rows.length - 1]?.t
    if (sourceIds.length > 0 && lastT !== undefined) {
      if (xChannel === 't') {
        const st = niceStep(x[1] - x[0], tickCount.x)
        x = [Math.floor(x[0] / st) * st, Math.ceil(x[1] / st + 1e-9) * st]
      } else x = niceDomain(x[0], x[1], tickCount.x)
      const prev = sticky.current
      if (prev && lastT >= prev.lastT) {
        y = [Math.min(prev.y[0], y[0]), Math.max(prev.y[1], y[1])]
        // a rolling time window must be free to slide; a phase plot grows
        if (xChannel !== 't') x = [Math.min(prev.x[0], x[0]), Math.max(prev.x[1], x[1])]
      }
      sticky.current = { x, y, lastT }
    }
    x = [xMinP ?? x[0], xMaxP ?? x[1]]
    y = [yMinP ?? y[0], yMaxP ?? y[1]]
    if (!(y[1] > y[0])) y = [y[0] - 1, y[0] + 1]
    return { x, y }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, extras, hidden, autoY, xMinP, xMaxP, yMinP, yMaxP, xChannel, defaultX0, tickCount.x, tickCount.y, panels.map((p) => p.key).join(',')])
  const win = vp ?? homeView
  const xt = niceTicks(win.x[0], win.x[1], tickCount.x)
  const yt = niceTicks(win.y[0], win.y[1], tickCount.y)

  // ── Pan & zoom ── wheel zooms about the cursor (Shift: x only, Alt: y
  // only), drag pans 1:1, double-click resets. Wheel and reset EASE toward a
  // goal view each frame instead of jumping, so a burst of wheel ticks reads
  // as one continuous glide.
  const scales = useRef<{ x: AxisScale; y: AxisScale } | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ px: number; py: number; v: View; ux: number; uy: number } | null>(null)
  const goal = useRef<View | null>(null) // null = home
  const raf = useRef(0)
  const homeRef = useRef(homeView)
  homeRef.current = homeView
  const vpRef = useRef(vp)
  vpRef.current = vp
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // user = a gesture (coarse sampling, no tooltip); otherwise just following
  // the live auto-range.
  const [zoomed, setZoomed] = useState(false)
  const userAnim = useRef(false)
  const animate = (user: boolean) => {
    if (user && !userAnim.current) {
      userAnim.current = true
      setMoving(true)
    }
    if (raf.current) return
    const tick = () => {
      const cur = vpRef.current ?? homeRef.current
      const g = goal.current ?? homeRef.current
      const near = (a: Domain, b: Domain) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < (b[1] - b[0]) * 1e-3
      if (near(cur.x, g.x) && near(cur.y, g.y)) {
        raf.current = 0
        vpRef.current = g
        setVp(g)
        if (userAnim.current) {
          userAnim.current = false
          setMoving(false)
        }
        return
      }
      const mix = (a: Domain, b: Domain): Domain => [a[0] + (b[0] - a[0]) * 0.3, a[1] + (b[1] - a[1]) * 0.3]
      const next = { x: mix(cur.x, g.x), y: mix(cur.y, g.y) }
      vpRef.current = next
      setVp(next)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const resetView = () => {
    goal.current = null
    sticky.current = null
    setZoomed(false)
    animate(true)
  }
  // Auto-range changes (new data, new formula) glide too, unless zoomed.
  useEffect(() => {
    if (!goal.current) animate(false)
  }, [homeView]) // eslint-disable-line react-hooks/exhaustive-deps

  /** client point → chart px (the board may CSS-scale the whole object) */
  const localPt = (clientX: number, clientY: number) => {
    const svg = plotRef.current?.querySelector('svg.recharts-surface')
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    return { x: ((clientX - r.left) * svg.clientWidth) / r.width, y: ((clientY - r.top) * svg.clientHeight) / r.height, k: svg.clientWidth / r.width }
  }
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      const sc = scales.current
      const p = localPt(ev.clientX, ev.clientY)
      if (!sc?.x.invert || !sc.y.invert || !p) return
      // Own the wheel like the 3D graph does — the board would pan too.
      ev.preventDefault()
      ev.stopPropagation()
      const delta = Math.max(-150, Math.min(150, ev.deltaY || ev.deltaX))
      const f = Math.exp(delta * (ev.ctrlKey ? 0.01 : 0.002)) // ctrlKey = trackpad pinch
      const cx = sc.x.invert(p.x)
      const cy = sc.y.invert(p.y)
      // Zoom the GOAL, so fast ticks compound instead of fighting the easing.
      const base = (raf.current && goal.current) || vpRef.current || homeRef.current
      const zoom = ([a, b]: Domain, c: number): Domain => [c - (c - a) * f, c + (b - c) * f]
      goal.current = { x: ev.altKey ? base.x : zoom(base.x, cx), y: ev.shiftKey ? base.y : zoom(base.y, cy) }
      setZoomed(true)
      animate(true)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })
  const onPanStart = (e: React.PointerEvent) => {
    e.stopPropagation()
    const sc = scales.current
    const p = localPt(e.clientX, e.clientY)
    if (e.button !== 0 || !sc || !p) return
    cancelAnimationFrame(raf.current)
    raf.current = 0
    userAnim.current = false
    const v = vpRef.current ?? homeRef.current
    // data units per screen px, straight from the scale
    const ux = ((v.x[1] - v.x[0]) / (sc.x(v.x[1]) - sc.x(v.x[0]))) * p.k
    const uy = ((v.y[1] - v.y[0]) / (sc.y(v.y[1]) - sc.y(v.y[0]))) * p.k
    pan.current = { px: e.clientX, py: e.clientY, v, ux, uy }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPanMove = (e: React.PointerEvent) => {
    const g = pan.current
    if (!g || Math.abs(e.clientX - g.px) + Math.abs(e.clientY - g.py) < 3) return
    if (!moving) setMoving(true)
    if (!zoomed) setZoomed(true)
    const dx = (e.clientX - g.px) * g.ux
    const dy = (e.clientY - g.py) * g.uy
    const next: View = { x: [g.v.x[0] - dx, g.v.x[1] - dx], y: [g.v.y[0] - dy, g.v.y[1] - dy] }
    goal.current = next
    vpRef.current = next
    setVp(next)
  }
  const onPanEnd = () => {
    pan.current = null
    setMoving(false) // settles → full-quality resample
  }
  const useStacked = stacked && panels.length > 1

  // ── Data view (graph → table) ── the plotted values as rows: live series
  // thinned to ~40 samples, formulas read at round x steps, points / table
  // rows at their own x. Same numbers the chart draws.
  const dataView = getString(object, 'dataView') === '1'
  const dataCols = [
    ...panels.map((p, i) => ({ key: p.key, name: p.formula ? formulas[i - series.length].expr : p.name, color: p.color })),
    ...extras.map((x, i) => ({ key: x.key, name: x.name, color: extraColor(i) })),
  ].filter((c) => !hidden.has(c.key))
  const dataRows = useMemo(() => {
    if (!dataView) return []
    const byX = new Map<number, Record<string, number>>()
    const put = (x: number, key: string, v: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(v)) return
      const k = Number(x.toPrecision(10))
      const r = byX.get(k) ?? { [xChannel]: k }
      r[key] = v
      byX.set(k, r)
    }
    if (sourceIds.length > 0) {
      const every = Math.max(1, Math.ceil(rows.length / 40))
      rows.forEach((r, i) => {
        if (i % every && i !== rows.length - 1) return
        for (const p of panels) put(r[xChannel], p.key, r[p.key])
      })
    } else if (formulas.length) {
      const sc: Scope = { ...scope }
      for (const x of niceTicks(win.x[0], win.x[1], 12).ticks) {
        sc[xChannel] = sc.x = sc.t = x
        formulas.forEach((f, i) => put(x, `f${i}`, f.fn(sc).value))
      }
    }
    for (const e of extras) for (const r of e.data) put(r[xChannel], e.key, r[e.key])
    return [...byX.values()].sort((a, b) => a[xChannel] - b[xChannel]).slice(0, 400)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataView, rows, extras, formulas, scope, win.x[0], win.x[1], xChannel, sourceIds.length])

  // Snapshot the data view into a real Table object beside the graph.
  const copyToTable = () => {
    const used = new Set<string>()
    const header = (n: string) => {
      let h = n.replace(/[=;]/g, ' ').replace(/\s+/g, ' ').trim() || 'y'
      while (used.has(h)) h += "'"
      used.add(h)
      return h
    }
    const cols = [header(xChannel), ...dataCols.map((c) => header(c.name))]
    const cells = dataRows.map((r) =>
      [xChannel, ...dataCols.map((c) => c.key)].map((k) => (Number.isFinite(r[k]) ? String(Number(r[k].toPrecision(6))) : ''))
    )
    const t = createGeometry('table', { x: object.position.x + object.size.w + 24, y: object.position.y })
    t.name = `${object.name} data`
    t.size = { w: Math.min(640, 70 + 96 * cols.length), h: Math.min(420, 80 + 24 * cells.length) }
    t.parameters.headers = str(serializeHeaders(cols.map((name) => ({ name, expr: null }))))
    t.parameters.data = str(serializeData(cells))
    useDocStore.getState().addObject(pageId, t)
  }
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
        <ProbeButtons pageId={pageId} object={object} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {[...panels, ...extras].map((p) => p.name).join(', ') || 'Graph'}
          {hasPlot ? ` vs ${xChannel}` : ''}
        </span>
        {zoomed && (
          <button
            type="button"
            aria-label="Reset view"
            title="Reset zoom & pan (or double-click the chart)"
            className="rounded p-0.5 text-[var(--accent-blue)]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={resetView}
          >
            <Maximize className="h-3.5 w-3.5" />
          </button>
        )}
        {hasPlot && view === '2d' && (
          <button
            type="button"
            aria-label={dataView ? 'Show chart' : 'Show values as a table'}
            aria-pressed={dataView}
            title={dataView ? 'Back to the chart' : 'Data view — the plotted values as a table'}
            className={
              dataView
                ? 'rounded p-0.5 text-[var(--accent-blue)]'
                : 'rounded p-0.5 text-muted-foreground hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'dataView', dataView ? '' : '1')}
          >
            <Table2 className="h-3.5 w-3.5" />
          </button>
        )}
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
        {view === '2d' && panels.length > 1 && (
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
        {panels.length >= 3 && (
          <button
            type="button"
            aria-label={view === '3d' ? 'Switch to 2D chart' : 'Switch to 3D trajectory view'}
            aria-pressed={view === '3d'}
            title={
              view === '3d'
                ? '3D view — first 3 series/formulas plotted as X/Y/Z'
                : 'Plot the first 3 series/formulas as a 3D trajectory'
            }
            className={
              view === '3d'
                ? 'rounded p-0.5 text-[var(--accent-blue)]'
                : 'rounded p-0.5 text-muted-foreground hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'view', view === '3d' ? '' : '3d')}
          >
            <Box className="h-3.5 w-3.5" />
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
      {deriv && view === '2d' && (
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
      {integ && view === '2d' && (
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
      {view === '3d' ? (
        panels.length >= 3 && rows.length > 1 ? (
          <Graph3D
            rows={rows}
            axes={[panels[0], panels[1], panels[2]]}
            xChannel={xChannel}
            deriv={deriv}
            integ={integ}
            intA={intA}
            intB={intB}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
            Pick at least 3 series or formulas — the first three become the X, Y, Z axes of the trajectory.
          </div>
        )
      ) : hasPlot && dataView ? (
        <DataView xName={xChannel} cols={dataCols} rows={dataRows} onCopy={copyToTable} />
      ) : hasPlot && useStacked ? (
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
                    domain={yDomain}
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
                    type={p.step ? 'stepAfter' : p.formula ? 'linear' : 'monotone'}
                    dataKey={p.key}
                    name={p.name}
                    stroke={p.color}
                    strokeWidth={1.8}
                    strokeDasharray={p.dash}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={!p.formula}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      ) : hasPlot ? (
        <div
          ref={plotRef}
          className="relative min-h-0 flex-1 cursor-grab p-1 text-[10px] active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onPointerDown={onPanStart}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerCancel={onPanEnd}
          onDoubleClick={(e) => {
            e.stopPropagation()
            resetView()
          }}
        >
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
              {/* Grid lines sit exactly on the round ticks below. */}
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} />
              <XAxis
                dataKey={xChannel}
                type="number"
                domain={win.x}
                ticks={xt.ticks}
                interval={0}
                tickFormatter={(v: number) => fmtTick(v, xt.step)}
                allowDataOverflow
                stroke="var(--muted-foreground)"
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                fontSize={10}
                label={{ value: `${xChannel} →`, position: 'insideBottomRight', offset: -2, fontSize: 10, fill: 'var(--muted-foreground)' }}
              />
              <YAxis
                type="number"
                domain={win.y}
                ticks={yt.ticks}
                interval={0}
                tickFormatter={(v: number) => fmtTick(v, yt.step)}
                allowDataOverflow
                stroke="var(--muted-foreground)"
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                fontSize={10}
                width={46}
              />
              {/* The axes through the origin — the one thing you look for first. */}
              {win.x[0] < 0 && win.x[1] > 0 && (
                <ReferenceLine x={0} stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1.25} />
              )}
              {win.y[0] < 0 && win.y[1] > 0 && (
                <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1.25} />
              )}
              <Tooltip {...tooltipProps} active={moving ? false : undefined} />
              <Legend
                wrapperStyle={{ fontSize: 10.5, cursor: 'pointer' }}
                iconSize={8}
                onClick={(it: { dataKey?: unknown }) => toggleHidden(String(it.dataKey))}
              />
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
              {pinnedRows.length > 1 &&
                panels.map((p) => (
                  <Line
                    key={`pin-${p.key}`}
                    type={p.step ? 'stepAfter' : 'monotone'}
                    data={pinnedRows}
                    dataKey={p.key}
                    name={`${p.name} (pinned)`}
                    stroke={p.color}
                    strokeOpacity={0.35}
                    strokeWidth={1.5}
                    strokeDasharray="2 3"
                    dot={false}
                    legendType="none"
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              {panels.map((p) => (
                <Line
                  key={p.key}
                  type={p.step ? 'stepAfter' : p.formula ? 'linear' : 'monotone'}
                  dataKey={p.key}
                  name={p.name}
                  stroke={p.color}
                  strokeWidth={1.8}
                  strokeDasharray={p.dash}
                  dot={false}
                  isAnimationActive={false}
                  // Formula gaps are real (undefined / discontinuity); live
                  // multi-source rows are merely unaligned, so bridge those.
                  connectNulls={!p.formula}
                  hide={hidden.has(p.key)}
                />
              ))}
              {extras.map((x, i) => (
                <Line
                  key={x.key}
                  type="linear"
                  data={x.data}
                  dataKey={x.key}
                  name={x.name}
                  stroke={extraColor(i)}
                  strokeWidth={x.line ? 1.8 : 0}
                  dot={x.points ? { r: 3.5, fill: extraColor(i), strokeWidth: 0 } : false}
                  legendType={x.line ? 'line' : 'circle'}
                  isAnimationActive={false}
                  hide={hidden.has(x.key)}
                />
              ))}
              <Customized
                component={(cp: object) => (
                  <ScaleProbe {...cp} onScales={(x, y) => (scales.current = { x, y })} />
                )}
              />
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
            : 'Type below: y = x^2, sin(t), (1, 2), (3, 4) or (cos(t), sin(t)) — or add a live series in the Inspector.'}
        </div>
      )}
      {(selected || (!hasSeries && !tableObj && entries.length === 0)) && (
        <FormulaBar
          entries={entries.map(({ raw, e }, i) => ({
            raw,
            key: e.kind === 'fn' ? `f${formulas.findIndex((f) => f.name === raw)}` : `e${i}`,
            color:
              e.kind === 'fn'
                ? GRAPH_COLORS[(series.length + formulas.findIndex((f) => f.name === raw)) % GRAPH_COLORS.length]
                : e.kind === 'vline'
                  ? 'var(--accent-rose)'
                  : extraColor(extras.findIndex((x) => x.key === `e${i}`)),
          }))}
          hidden={hidden}
          table={tableObj ? tableObj.name : undefined}
          onUnlinkTable={() => setStringParam(pageId, object.id, 'tableId', '')}
          onToggle={toggleHidden}
          onChange={(list) => setStringParam(pageId, object.id, 'formulas', list.join('; '))}
        />
      )}
    </div>
  )
}

/** Calculator-style entry strip: every plotted formula as a chip (click to
 *  hide, × to remove) plus an input — Enter adds whatever you type. */
function FormulaBar({
  entries,
  hidden,
  table,
  onUnlinkTable,
  onToggle,
  onChange,
}: {
  entries: { raw: string; key: string; color: string }[]
  hidden: ReadonlySet<string>
  table?: string
  onUnlinkTable: () => void
  onToggle: (key: string) => void
  onChange: (list: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const list = entries.map((e) => e.raw)
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-t border-border/60 px-2 py-1"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {table && (
        <span className="flex items-center gap-1 rounded-md bg-accent/50 py-0.5 pl-1.5 pr-0.5 text-[10.5px]">
          <TableProperties className="h-3 w-3 text-muted-foreground" aria-hidden />
          {table}
          <button
            type="button"
            aria-label={`Unlink ${table}`}
            className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
            onClick={onUnlinkTable}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      )}
      {entries.map((e, i) => (
        <span
          key={i}
          className="flex items-center gap-1 rounded-md bg-accent/50 py-0.5 pl-1.5 pr-0.5 font-mono text-[10.5px]"
          style={{ opacity: hidden.has(e.key) ? 0.45 : 1 }}
        >
          <button
            type="button"
            aria-label={`${hidden.has(e.key) ? 'Show' : 'Hide'} ${e.raw}`}
            className="flex items-center gap-1"
            onClick={() => onToggle(e.key)}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden />
            {e.raw}
          </button>
          <button
            type="button"
            aria-label={`Remove ${e.raw}`}
            className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
            onClick={() => onChange(list.filter((_, j) => j !== i))}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        aria-label="Add a formula, points or parametric curve"
        className="min-w-[8rem] flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground/70"
        placeholder={entries.length ? 'Add…' : 'y = x^2   ·   (1, 2), (3, 4)   ·   (cos(t), sin(t))'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation() // board shortcuts (Delete, letters) must not fire while typing
          if (e.key !== 'Enter' || !draft.trim()) return
          // ';' separates entries in the stored list — a typed one splits too.
          onChange([...list, ...splitList(draft)])
          setDraft('')
        }}
      />
    </div>
  )
}

/** The graph's numbers as a read-only table, with a one-click copy into a
 *  real (editable) Table object. */
function DataView({
  xName,
  cols,
  rows,
  onCopy,
}: {
  xName: string
  cols: { key: string; name: string; color: string }[]
  rows: Record<string, number>[]
  onCopy: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" onPointerDown={(e) => e.stopPropagation()}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-card">
            <tr>
              <th className="border-b border-r border-border/50 px-2 py-1 text-left font-semibold text-muted-foreground">
                {xName}
              </th>
              {cols.map((c) => (
                <th key={c.key} className="border-b border-r border-border/50 px-2 py-1 text-right font-semibold" style={{ color: c.color }}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-accent/20' : undefined}>
                <td className="border-r border-border/40 px-2 py-0.5 text-muted-foreground">{fmtNum(r[xName])}</td>
                {cols.map((c) => (
                  <td key={c.key} className="border-r border-border/40 px-2 py-0.5 text-right">
                    {Number.isFinite(r[c.key]) ? fmtNum(r[c.key]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 px-2 py-1 text-[10.5px] text-muted-foreground">
        <span>{rows.length} rows</span>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-[var(--accent-blue)] hover:bg-accent"
          onClick={onCopy}
        >
          <TableProperties className="h-3 w-3" /> Copy to table
        </button>
      </div>
    </div>
  )
}
