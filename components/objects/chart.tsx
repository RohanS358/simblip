'use client'

// Chart tool — bar/line/area/scatter/pie over a small inline-editable data
// table (labels x one-or-more series), the spreadsheet-simple counterpart to
// the Graph object's live-simulation/function plotting. Switching chart type
// keeps the SAME data (same convention as flipping chart type in a
// spreadsheet) — there's exactly one thing to learn: edit the grid, pick a
// shape. "Stacked" is a modifier on bar/area, not a separate chart family,
// matching how the Graph object's own `stacked` toggle already works.

import { useMemo } from 'react'
import type { ReactElement } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  BarChart3,
  LineChart as LineChartIcon,
  AreaChart as AreaChartIcon,
  ScatterChart as ScatterChartIcon,
  PieChart as PieChartIcon,
  Layers,
  Plus,
  X,
} from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { GRAPH_COLORS } from './graph'
import { getString, type ObjectRendererProps } from './types'

export type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie'

interface Series {
  name: string
  values: number[]
}

const splitList = (s: string) => s.split(';').map((c) => c.trim()).filter((c) => c.length > 0)

/** `series` param shape: series separated by "||", each "Name|v1;v2;v3". */
function parseSeries(raw: string): Series[] {
  if (!raw.trim()) return []
  return raw.split('||').map((part) => {
    const i = part.indexOf('|')
    const name = (i >= 0 ? part.slice(0, i) : 'Series').trim()
    const values = (i >= 0 ? part.slice(i + 1) : part).split(';').map((v) => Number(v.trim()) || 0)
    return { name: name || 'Series', values }
  })
}

function serializeSeries(list: Series[]): string {
  return list.map((s) => `${s.name}|${s.values.join(';')}`).join('||')
}

const CHART_TYPES: { id: ChartType; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'bar', icon: BarChart3, label: 'Bar' },
  { id: 'line', icon: LineChartIcon, label: 'Line' },
  { id: 'area', icon: AreaChartIcon, label: 'Area' },
  { id: 'scatter', icon: ScatterChartIcon, label: 'Scatter' },
  { id: 'pie', icon: PieChartIcon, label: 'Pie' },
]

const tooltipProps = {
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

function renderChart(chartType: ChartType, data: Record<string, string | number>[], cols: Series[], stacked: boolean): ReactElement {
  if (chartType === 'pie') {
    const first = cols[0]
    const pieData = data.map((d) => ({ name: String(d.label), value: Number(d[first?.name ?? ''] ?? 0) }))
    return (
      <PieChart>
        <Tooltip {...tooltipProps} />
        <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
        <Pie data={pieData} dataKey="value" nameKey="name" outerRadius="72%" isAnimationActive={false} label={(e: { name?: string }) => e.name}>
          {pieData.map((d, i) => (
            <Cell key={d.name + i} fill={GRAPH_COLORS[i % GRAPH_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    )
  }

  const axes = (
    <>
      <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
      <XAxis dataKey="label" type="category" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} />
      <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} width={38} />
      <Tooltip {...tooltipProps} />
      {cols.length > 1 && <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />}
    </>
  )

  if (chartType === 'line') {
    return (
      <LineChart data={data}>
        {axes}
        {cols.map((s, i) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={GRAPH_COLORS[i % GRAPH_COLORS.length]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
        ))}
      </LineChart>
    )
  }
  if (chartType === 'area') {
    return (
      <AreaChart data={data}>
        {axes}
        {cols.map((s, i) => (
          <Area
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={GRAPH_COLORS[i % GRAPH_COLORS.length]}
            fill={GRAPH_COLORS[i % GRAPH_COLORS.length]}
            fillOpacity={0.28}
            stackId={stacked ? 'a' : undefined}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    )
  }
  if (chartType === 'scatter') {
    return (
      <ScatterChart>
        {axes}
        {cols.map((s, i) => (
          <Scatter key={s.name} name={s.name} data={data} dataKey={s.name} fill={GRAPH_COLORS[i % GRAPH_COLORS.length]} isAnimationActive={false} />
        ))}
      </ScatterChart>
    )
  }
  // bar (default)
  return (
    <BarChart data={data}>
      {axes}
      {cols.map((s, i) => (
        <Bar key={s.name} dataKey={s.name} fill={GRAPH_COLORS[i % GRAPH_COLORS.length]} stackId={stacked ? 'a' : undefined} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      ))}
    </BarChart>
  )
}

export function ChartObject({ pageId, object }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)

  const chartType = (getString(object, 'chartType', 'bar') || 'bar') as ChartType
  const stacked = getString(object, 'stacked') === '1'
  const labelsStr = getString(object, 'labels', 'A;B;C;D')
  const seriesStr = getString(object, 'series', 'Series 1|10;25;16;30')

  const parsedLabels = useMemo(() => splitList(labelsStr), [labelsStr])
  const parsedSeries = useMemo(() => parseSeries(seriesStr), [seriesStr])
  // Always at least 3 rows / 1 series so a fresh drop already renders something.
  const rows = parsedLabels.length < 3 ? [...parsedLabels, ...Array(3 - parsedLabels.length).fill('')] : parsedLabels
  const cols = parsedSeries.length > 0 ? parsedSeries : [{ name: 'Series 1', values: rows.map(() => 0) }]

  const commit = (nextLabels: string[], nextSeries: Series[]) => {
    pushHistory(pageId)
    setStringParam(pageId, object.id, 'labels', nextLabels.join(';'))
    setStringParam(pageId, object.id, 'series', serializeSeries(nextSeries))
  }

  const updateLabel = (r: number, v: string) => commit(rows.map((l, i) => (i === r ? v : l)), cols)
  const updateCell = (r: number, c: number, v: string) =>
    commit(
      rows,
      cols.map((s, i) => (i === c ? { ...s, values: s.values.map((x, j) => (j === r ? Number(v) || 0 : x)) } : s))
    )
  const updateSeriesName = (c: number, v: string) => commit(rows, cols.map((s, i) => (i === c ? { ...s, name: v } : s)))
  const addRow = () => commit([...rows, ''], cols.map((s) => ({ ...s, values: [...s.values, 0] })))
  const removeRow = (r: number) => {
    if (rows.length <= 1) return
    commit(rows.filter((_, i) => i !== r), cols.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== r) })))
  }
  const addSeries = () => commit(rows, [...cols, { name: `Series ${cols.length + 1}`, values: rows.map(() => 0) }])
  const removeSeries = (c: number) => {
    if (cols.length <= 1) return
    commit(rows, cols.filter((_, i) => i !== c))
  }

  const data = useMemo(
    () =>
      rows.map((label, i) => ({
        label: label || `#${i + 1}`,
        ...Object.fromEntries(cols.map((s) => [s.name, s.values[i] ?? 0])),
      })),
    [rows, cols]
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      {/* No stopPropagation on the row itself — like every other object's
          header, empty space here is the drag handle to relocate the card.
          Each button stops it individually so a click doesn't also start a
          drag (same pattern as Graph's and 3D Graph's header buttons). */}
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        {CHART_TYPES.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={chartType === id}
            title={label}
            className={
              chartType === id
                ? 'rounded-md bg-[var(--accent-blue)]/10 p-1 text-[var(--accent-blue)]'
                : 'rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'chartType', id)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <div className="flex-1" />
        {(chartType === 'bar' || chartType === 'area') && (
          <button
            type="button"
            aria-label={stacked ? 'Unstack series' : 'Stack series'}
            aria-pressed={stacked}
            title={stacked ? 'Stacked: on' : 'Stack series'}
            className={stacked ? 'rounded-md p-1 text-[var(--accent-blue)]' : 'rounded-md p-1 text-muted-foreground hover:text-foreground'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'stacked', stacked ? '' : '1')}
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 p-1 text-[10px]" onPointerDown={(e) => e.stopPropagation()}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(chartType, data, cols, stacked)}
        </ResponsiveContainer>
      </div>

      {/* inline data grid — same interaction language as the Formula Table */}
      <div className="max-h-[42%] shrink-0 overflow-auto border-t border-border/60" onPointerDown={(e) => e.stopPropagation()}>
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="bg-[var(--accent-blue)]/8">
              <th className="min-w-[56px] border-b border-r border-border/50 px-1.5 py-1 text-left text-[10.5px] font-semibold text-muted-foreground">
                Label
              </th>
              {cols.map((s, c) => (
                <th key={c} className="min-w-[64px] border-b border-r border-border/50 px-1 py-1 text-left">
                  <div className="flex items-center gap-1">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: GRAPH_COLORS[c % GRAPH_COLORS.length] }}
                      aria-hidden
                    />
                    <input
                      type="text"
                      spellCheck={false}
                      value={s.name}
                      onChange={(e) => updateSeriesName(c, e.target.value)}
                      aria-label={`Series ${c + 1} name`}
                      className="w-full min-w-0 bg-transparent text-foreground outline-none"
                    />
                    {cols.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove series ${s.name}`}
                        onClick={() => removeSeries(c)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-50 transition-opacity hover:text-[var(--accent-rose)] hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-6 border-b border-border p-0">
                <button
                  type="button"
                  aria-label="Add series"
                  onClick={addSeries}
                  className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((label, r) => (
              <tr key={r} className={r % 2 ? 'bg-accent/20' : undefined}>
                <td className="border-r border-border/40 p-0">
                  <input
                    type="text"
                    spellCheck={false}
                    value={label}
                    onChange={(e) => updateLabel(r, e.target.value)}
                    aria-label={`Row ${r + 1} label`}
                    className="w-full bg-transparent px-1.5 py-0.5 text-foreground outline-none"
                    placeholder={`#${r + 1}`}
                  />
                </td>
                {cols.map((s, c) => (
                  <td key={c} className="border-r border-border/40 p-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      spellCheck={false}
                      value={s.values[r] ?? 0}
                      onChange={(e) => updateCell(r, c, e.target.value)}
                      aria-label={`Row ${r + 1} ${s.name}`}
                      className="w-full bg-transparent px-1.5 py-0.5 text-right text-foreground outline-none tabular-nums"
                    />
                  </td>
                ))}
                <td className="p-0">
                  <button
                    type="button"
                    aria-label={`Remove row ${r + 1}`}
                    onClick={() => removeRow(r)}
                    disabled={rows.length <= 1}
                    className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-[var(--accent-rose)] disabled:opacity-30"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addRow}
          className="flex w-full items-center justify-center gap-1 border-t border-border/40 py-1 text-[10.5px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Add row
        </button>
      </div>
    </div>
  )
}
