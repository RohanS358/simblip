'use client'

// Call / recursion tree for the DSA Lab. Every function call is a node;
// recursive calls branch out with their own parameters, so fib(5) literally
// grows into a tree. Nodes appear at the step where the call happened and
// show their return value once they finish.

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CallNode, TraceResult } from '@/lib/dsa/trace'

const X_GAP = 118
const Y_GAP = 74
const NODE_W = 104
const NODE_H = 40

interface Placed {
  node: CallNode
  x: number
  y: number
}

function layoutTree(nodes: Record<string, CallNode>, roots: string[]): { placed: Placed[]; w: number; h: number } {
  const placed: Placed[] = []
  let nextLeaf = 0
  let maxDepth = 0
  const assign = (id: string, depth: number): number => {
    const n = nodes[id]
    if (!n) return nextLeaf
    maxDepth = Math.max(maxDepth, depth)
    let x: number
    if (n.children.length === 0) {
      x = nextLeaf++
    } else {
      const xs = n.children.map((c) => assign(c, depth + 1))
      x = (Math.min(...xs) + Math.max(...xs)) / 2
    }
    placed.push({ node: n, x, y: depth })
    return x
  }
  for (const r of roots) {
    assign(r, 0)
    nextLeaf++ // gap between separate root calls
  }
  return {
    placed,
    w: Math.max(1, nextLeaf) * X_GAP + 40,
    h: (maxDepth + 1) * Y_GAP + NODE_H + 24,
  }
}

export function DsaTreeView({ trace, stepIdx }: { trace: TraceResult | null; stepIdx: number }) {
  const [fit, setFit] = useState(true)
  const layout = useMemo(
    () => (trace ? layoutTree(trace.callNodes, trace.rootCalls) : null),
    [trace]
  )

  if (!trace || !layout || layout.placed.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Call a function to grow the tree.
      </div>
    )
  }

  const step = trace.steps[Math.min(stepIdx, trace.steps.length - 1)]
  const activeId = step?.activeCall

  // path from active node to the root — gets the "sap" highlight
  const activePath = new Set<string>()
  let cur = activeId
  while (cur && trace.callNodes[cur]) {
    activePath.add(cur)
    cur = trace.callNodes[cur].parent ?? ''
  }

  const px = (x: number) => x * X_GAP + 20 + NODE_W / 2
  const py = (y: number) => y * Y_GAP + 16 + NODE_H / 2

  const visible = layout.placed.filter((p) => p.node.startStep <= stepIdx)

  return (
    <div
      className={cn('relative h-full', fit ? 'overflow-hidden' : 'overflow-auto')}
      onWheelCapture={(e) => {
        // keep in-pane scrolling from panning the workspace canvas underneath
        if (!fit) e.stopPropagation()
      }}
    >
      <button
        type="button"
        onClick={() => setFit((f) => !f)}
        className="absolute right-2 top-2 z-10 rounded-md border border-border/60 bg-[var(--card)]/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
      >
        {fit ? '1:1' : 'Fit'}
      </button>
      <svg
        {...(fit
          ? { viewBox: `0 0 ${layout.w} ${layout.h}`, preserveAspectRatio: 'xMidYMin meet', width: '100%', height: '100%' }
          : { width: layout.w, height: layout.h, className: 'min-h-full min-w-full' })}
      >
        {/* branches first, so nodes draw on top */}
        {visible.map((p) => {
          if (!p.node.parent) return null
          const parent = layout.placed.find((q) => q.node.id === p.node.parent)
          if (!parent) return null
          const x1 = px(parent.x)
          const y1 = py(parent.y) + NODE_H / 2 - 4
          const x2 = px(p.x)
          const y2 = py(p.y) - NODE_H / 2 + 4
          const onPath = activePath.has(p.node.id) && activePath.has(parent.node.id)
          return (
            <path
              key={`e${p.node.id}`}
              d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
              fill="none"
              stroke={onPath ? 'var(--accent-mint)' : 'var(--border)'}
              strokeWidth={onPath ? 2.5 : Math.max(1.2, 3 - p.node.depth * 0.35)}
              strokeLinecap="round"
            />
          )
        })}
        {visible.map((p) => {
          const done = p.node.endStep !== undefined && p.node.endStep <= stepIdx
          const isActive = p.node.id === activeId
          const onPath = activePath.has(p.node.id)
          return (
            <g key={p.node.id} transform={`translate(${px(p.x) - NODE_W / 2}, ${py(p.y) - NODE_H / 2})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                className="transition-all duration-200"
                fill={
                  isActive
                    ? 'color-mix(in oklch, var(--accent-mint) 22%, var(--card))'
                    : done
                      ? 'var(--card)'
                      : 'color-mix(in oklch, var(--accent-amber) 10%, var(--card))'
                }
                stroke={isActive ? 'var(--accent-mint)' : onPath ? 'color-mix(in oklch, var(--accent-mint) 60%, var(--border))' : 'var(--border)'}
                strokeWidth={isActive ? 2 : 1}
              />
              <text
                x={NODE_W / 2}
                y={done ? 16 : NODE_H / 2 + 4}
                textAnchor="middle"
                className="fill-foreground font-mono"
                fontSize={11}
                fontWeight={600}
              >
                {truncate(`${p.node.fn}(${p.node.args})`, 16)}
              </text>
              {done && (
                <text x={NODE_W / 2} y={31} textAnchor="middle" fontSize={10} className="fill-[var(--accent-blue)] font-mono">
                  {truncate(`→ ${p.node.ret ?? ''}`, 15)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
