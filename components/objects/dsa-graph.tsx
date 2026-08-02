'use client'

// Graph view for the DSA Lab: whenever the running program has a
// `vector<vector<int>>` adjacency list anywhere in memory — a bare local or,
// as in the textbook `class Graph { vector<vector<int>> adjList; }` shape, a
// field nested inside an object — lib/dsa/interpreter.ts's `snapshotGraph`
// finds it and this renders it as an actual node/edge diagram instead of the
// Memory tab's opaque nested-array summary. A same-shaped `vector<bool>` is
// picked up as a visited set (mint fill, amber ring on the cell written this
// exact step) and a `queue<int>`/`stack<int>` as the BFS/DFS frontier strip
// — the exact three ingredients the standard traversal idiom declares.

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { GraphSnap, TraceStep } from '@/lib/dsa/trace'

const SIZE = 300
const CX = SIZE / 2
const CY = SIZE / 2

function layout(nodeCount: number): { x: number; y: number }[] {
  const r = nodeCount <= 1 ? 0 : Math.min(120, 40 + nodeCount * 8)
  return Array.from({ length: nodeCount }, (_, i) => {
    if (nodeCount === 1) return { x: CX, y: CY }
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodeCount
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
  })
}

function GraphSvg({ graph }: { graph: GraphSnap }) {
  const pts = useMemo(() => layout(graph.nodeCount), [graph.nodeCount])
  const nodeR = graph.nodeCount > 14 ? 9 : graph.nodeCount > 8 ? 12 : 16

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[360px]">
      <defs>
        <marker id="dsa-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {graph.edges.map((e, i) => {
        const p1 = pts[e.a]
        const p2 = pts[e.b]
        if (!p1 || !p2) return null
        // The edge just walked from prevVisitedNode → visitedNode, in
        // either direction (an undirected edge doesn't care which way the
        // traversal used it).
        const isTraveled =
          graph.prevVisitedNode !== null &&
          graph.visitedNode !== null &&
          ((e.a === graph.prevVisitedNode && e.b === graph.visitedNode) ||
            (e.a === graph.visitedNode && e.b === graph.prevVisitedNode))
        // Shorten so the line/arrow ends at the node's rim, not its center.
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const x1 = p1.x + ux * nodeR
        const y1 = p1.y + uy * nodeR
        const x2 = p2.x - ux * (nodeR + (e.directed ? 5 : 0))
        const y2 = p2.y - uy * (nodeR + (e.directed ? 5 : 0))
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={isTraveled ? 'var(--accent-amber)' : 'var(--muted-foreground)'}
            strokeOpacity={isTraveled ? 0.95 : 0.55}
            strokeWidth={isTraveled ? 2.5 : 1.5}
            markerEnd={e.directed ? 'url(#dsa-graph-arrow)' : undefined}
          />
        )
      })}
      {pts.map((p, i) => {
        const isVisited = graph.visited?.[i] === true
        const isCurrent = graph.visitedNode === i
        const isPrev = graph.prevVisitedNode === i
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={nodeR}
              fill={isVisited ? 'color-mix(in oklch, var(--accent-mint) 30%, var(--card))' : 'var(--card)'}
              stroke={
                isCurrent
                  ? 'var(--accent-amber)'
                  : isPrev
                    ? 'var(--accent-blue)'
                    : isVisited
                      ? 'var(--accent-mint)'
                      : 'var(--border)'
              }
              strokeWidth={isCurrent ? 2.5 : isPrev ? 2 : 1.5}
              strokeDasharray={isPrev ? '3 2' : undefined}
            />
            <text
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="select-none font-mono font-semibold"
              fontSize={nodeR}
              fill="var(--foreground)"
            >
              {i}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function FrontierStrip({ graph }: { graph: GraphSnap }) {
  if (!graph.queue) return null
  const label = graph.queueKind === 'stack' ? 'Stack · top → bottom' : 'Queue · front → back'
  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border/40 px-3 py-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      {graph.queue.length === 0 ? (
        <span className="text-[11px] italic text-muted-foreground">empty</span>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {graph.queue.map((v, i) => (
            <div
              key={i}
              className={cn(
                'flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-[11px]',
                i === 0
                  ? 'border-[var(--accent-amber)] bg-[color-mix(in_oklch,var(--accent-amber)_16%,transparent)] font-semibold'
                  : 'border-border/60'
              )}
            >
              {Number.isFinite(v) ? v : '?'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function DsaGraphView({ step }: { step: TraceStep | null }) {
  const graph = step?.graph ?? null

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
        No adjacency-list graph in scope yet — declare a{' '}
        <span className="font-mono">vector&lt;vector&lt;int&gt;&gt;</span> (a plain local, or a field like{' '}
        <span className="font-mono">class Graph {'{'} vector&lt;vector&lt;int&gt;&gt; adjList; {'}'}</span>) and it
        shows up here automatically.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="min-h-0 flex-1 p-3">
        <GraphSvg graph={graph} />
      </div>
      {graph.visited && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/40 px-3 py-1.5 text-[9.5px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full border border-[var(--accent-mint)] bg-[color-mix(in_oklch,var(--accent-mint)_30%,var(--card))]" />
            visited
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full border-2 border-[var(--accent-amber)]" />
            just written
          </span>
          {graph.prevVisitedNode !== null && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border-2 border-dashed border-[var(--accent-blue)]" />
              visited before
            </span>
          )}
        </div>
      )}
      <FrontierStrip graph={graph} />
    </div>
  )
}
