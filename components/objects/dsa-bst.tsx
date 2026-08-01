'use client'

// Binary tree view for the DSA Lab: whenever the running program's memory
// has a struct with two self-referential pointer fields — `Node* left;
// Node* right;`, whatever they're actually named — lib/dsa/interpreter.ts's
// `snapshotTree` finds it (root = the one instance nobody else points at)
// and this renders it as an actual tree diagram instead of the Memory tab's
// tangle of boxes and crossing pointer arrows. Covers BST/AVL/heap-as-tree
// construction and traversal; a doubly-linked list has the same two-pointer
// shape but never finds a root (every node is referenced by some neighbor),
// so it correctly falls through to the Memory view instead of misrendering.

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { TraceStep, TreeNodeSnap } from '@/lib/dsa/trace'

const X_GAP = 64
const Y_GAP = 66
const NODE_R = 20

interface Placed {
  node: TreeNodeSnap
  x: number
  y: number
}

function layoutBst(root: TreeNodeSnap): { placed: Placed[]; w: number; h: number } {
  const placed: Placed[] = []
  let nextLeaf = 0
  let maxDepth = 0
  const assign = (node: TreeNodeSnap | null, depth: number): number | null => {
    if (!node) return null
    maxDepth = Math.max(maxDepth, depth)
    const lx = assign(node.left, depth + 1)
    const rx = assign(node.right, depth + 1)
    const x = lx !== null && rx !== null ? (lx + rx) / 2 : lx !== null ? lx : rx !== null ? rx : nextLeaf++
    placed.push({ node, x, y: depth })
    return x
  }
  assign(root, 0)
  return {
    placed,
    w: Math.max(1, nextLeaf) * X_GAP + NODE_R * 2 + 24,
    h: (maxDepth + 1) * Y_GAP + NODE_R * 2 + 16,
  }
}

export function DsaBstView({ step }: { step: TraceStep | null }) {
  const [fit, setFit] = useState(true)
  const tree = step?.tree ?? null
  const layout = useMemo(() => (tree ? layoutBst(tree.root) : null), [tree])

  if (!tree || !layout) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
        No binary tree in scope yet — a struct with two self-referential pointer fields (e.g.{' '}
        <span className="font-mono">Node* left; Node* right;</span>) shows up here automatically once a root node
        exists.
      </div>
    )
  }

  const px = (x: number) => x * X_GAP + NODE_R + 12
  const py = (y: number) => y * Y_GAP + NODE_R + 8

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
        {layout.placed.map((p) => (
          <g key={`e${p.node.addr}`}>
            {p.node.left && (
              <line
                x1={px(p.x)}
                y1={py(p.y) + NODE_R - 2}
                x2={px(layout.placed.find((q) => q.node.addr === p.node.left!.addr)?.x ?? p.x)}
                y2={py(p.y + 1) - NODE_R + 2}
                stroke="var(--border)"
                strokeWidth={1.5}
              />
            )}
            {p.node.right && (
              <line
                x1={px(p.x)}
                y1={py(p.y) + NODE_R - 2}
                x2={px(layout.placed.find((q) => q.node.addr === p.node.right!.addr)?.x ?? p.x)}
                y2={py(p.y + 1) - NODE_R + 2}
                stroke="var(--border)"
                strokeWidth={1.5}
              />
            )}
          </g>
        ))}
        {layout.placed.map((p) => {
          const isTouched = tree.touchedAddr === p.node.addr
          return (
            <g key={p.node.addr}>
              <circle
                cx={px(p.x)}
                cy={py(p.y)}
                r={NODE_R}
                fill={isTouched ? 'color-mix(in oklch, var(--accent-amber) 22%, var(--card))' : 'var(--card)'}
                stroke={isTouched ? 'var(--accent-amber)' : 'var(--border)'}
                strokeWidth={isTouched ? 2.5 : 1.5}
                className="transition-[fill,stroke] duration-200"
              />
              <text
                x={px(p.x)}
                y={py(p.y)}
                textAnchor="middle"
                dominantBaseline="central"
                className="select-none fill-foreground font-mono font-semibold"
                fontSize={NODE_R > 16 ? 11 : 9.5}
              >
                {truncate(p.node.label, 6)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
