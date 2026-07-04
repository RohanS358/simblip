'use client'

import { useEffect, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { subscribe, readBuffer, decimate } from '@/lib/physics/bus'
import { getString, type ObjectRendererProps } from './types'

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
const MAX_POINTS = 300
const MIN_FRAME_MS = 80 // ≤ ~12 Hz chart repaint; the bus updates far faster

export function GraphObject({ object }: ObjectRendererProps) {
  const sourceId = getString(object, 'sourceId')
  const xChannel = getString(object, 'xChannel', 't')
  const yChannels = getString(object, 'yChannels')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)

  const [data, setData] = useState<Record<string, number>[]>([])
  const lastPaint = useRef(0)

  useEffect(() => {
    if (!sourceId) {
      setData([])
      return
    }
    const pull = () => {
      const now = performance.now()
      if (now - lastPaint.current < MIN_FRAME_MS) return
      lastPaint.current = now
      const buf = readBuffer(sourceId)
      if (!buf) return
      const rows = decimate(buf.samples, MAX_POINTS).map((s) => ({
        t: Number(s.t.toFixed(3)),
        ...s.channels,
      }))
      setData(rows)
    }
    pull()
    return subscribe(sourceId, pull)
  }, [sourceId, xChannel])

  const channels =
    yChannels.length > 0 ? yChannels : (readBuffer(sourceId)?.channelNames.slice(0, 2) ?? [])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      <div className="border-b border-border/60 px-3 py-1.5">
        <span className="text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {channels.length > 0 ? `${channels.join(', ')} vs ${xChannel}` : 'Graph'}
        </span>
      </div>
      {sourceId && data.length > 1 ? (
        <div className="min-h-0 flex-1 p-1 text-[10px]" onPointerDown={(e) => e.stopPropagation()}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
              <XAxis
                dataKey={xChannel}
                type="number"
                domain={['dataMin', 'dataMax']}
                stroke="var(--muted-foreground)"
                tickLine={false}
                axisLine={false}
                fontSize={10}
              />
              <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} fontSize={10} width={46} />
              <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
              {channels.map((c, i) => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={1.8}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
          {sourceId
            ? 'Run the bound simulation to see live data.'
            : 'Select this graph and pick a simulation source in the Inspector.'}
        </div>
      )}
    </div>
  )
}
