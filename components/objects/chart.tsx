'use client'

// Chart tool — bar/line/area/scatter/pie over a small data table (labels x
// one-or-more series), the spreadsheet-simple counterpart to the Graph
// object's live-simulation/function plotting. Switching chart type keeps the
// SAME data (same convention as flipping chart type in a spreadsheet) —
// there's exactly one thing to learn: edit the grid, pick a shape. "Stacked"
// is a modifier on bar/area, not a separate chart family, matching how the
// Graph object's own `stacked` toggle already works.
//
// The type selector and the data grid (incl. CSV import) live in the
// Inspector's properties panel (ChartOptions, inspector.tsx) — this card is
// just the rendered chart, so the object's own footprint stays chart-sized
// instead of losing ~40% of its height to an inline editor.

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
} from 'lucide-react'
import { GRAPH_COLORS } from './graph'
import { getString, type ObjectRendererProps } from './types'

export type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie'

export interface Series {
  name: string
  values: number[]
}

export const splitList = (s: string) => s.split(';').map((c) => c.trim()).filter((c) => c.length > 0)

/** `series` param shape: series separated by "||", each "Name|v1;v2;v3". */
export function parseSeries(raw: string): Series[] {
  if (!raw.trim()) return []
  return raw.split('||').map((part) => {
    const i = part.indexOf('|')
    const name = (i >= 0 ? part.slice(0, i) : 'Series').trim()
    const values = (i >= 0 ? part.slice(i + 1) : part).split(';').map((v) => Number(v.trim()) || 0)
    return { name: name || 'Series', values }
  })
}

export function serializeSeries(list: Series[]): string {
  return list.map((s) => `${s.name}|${s.values.join(';')}`).join('||')
}

export const CHART_TYPES: { id: ChartType; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
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

  // An ARRAY, not a fragment. Recharts 2.x discovers axes, grid and tooltip by
  // walking its own `children` — a <>...</> wraps them in one opaque node, so
  // the scan finds nothing and the chart renders as a bare line with no axes,
  // no gridlines and no hover. Spreading the array keeps them direct children.
  const axes = [
    <CartesianGrid key="grid" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />,
    <XAxis key="x" dataKey="label" type="category" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} />,
    <YAxis key="y" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} width={38} />,
    <Tooltip key="tip" {...tooltipProps} />,
    ...(cols.length > 1 ? [<Legend key="legend" wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />] : []),
  ]

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

export function ChartObject({ object }: ObjectRendererProps) {
  const chartType = (getString(object, 'chartType', 'bar') || 'bar') as ChartType
  const stacked = getString(object, 'stacked') === '1'
  const labelsStr = getString(object, 'labels', 'A;B;C;D')
  const seriesStr = getString(object, 'series', 'Series 1|10;25;16;30')

  const parsedLabels = useMemo(() => splitList(labelsStr), [labelsStr])
  const parsedSeries = useMemo(() => parseSeries(seriesStr), [seriesStr])
  // Always at least 3 rows / 1 series so a fresh drop already renders something.
  const rows = parsedLabels.length < 3 ? [...parsedLabels, ...Array(3 - parsedLabels.length).fill('')] : parsedLabels
  const cols = parsedSeries.length > 0 ? parsedSeries : [{ name: 'Series 1', values: rows.map(() => 0) }]

  const data = useMemo(
    () =>
      rows.map((label, i) => ({
        label: label || `#${i + 1}`,
        ...Object.fromEntries(cols.map((s) => [s.name, s.values[i] ?? 0])),
      })),
    [rows, cols]
  )

  // Type switching and the data grid moved to the Inspector's properties
  // panel (Chart type / Data sections, incl. CSV import) — the card itself
  // is now just the chart, with a small read-only badge for orientation.
  const activeType = CHART_TYPES.find((t) => t.id === chartType) ?? CHART_TYPES[0]

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5 text-[10.5px] font-medium text-muted-foreground">
        <activeType.icon className="h-3.5 w-3.5" />
        {activeType.label} chart
        {stacked && (chartType === 'bar' || chartType === 'area') && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9.5px]">Stacked</span>
        )}
      </div>

      <div className="min-h-0 flex-1 p-1 text-[10px]" onPointerDown={(e) => e.stopPropagation()}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(chartType, data, cols, stacked)}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
