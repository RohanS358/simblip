'use client'

// Memory view for the DSA Lab: every variable is a block (name on top,
// value inside, address underneath), arrays are cell strips with indices,
// heap allocations are violet, and pointers are dotted arrows drawn between
// the actual DOM positions of the cells. The most recent write glows amber.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { fmtAddr, type SnapBlock, type SnapCell, type TraceStep } from '@/lib/dsa/trace'

interface Arrow {
  x1: number
  y1: number
  x2: number
  y2: number
  dangling: boolean
}

function CellBox({
  cell,
  block,
  changed,
  reads,
}: {
  cell: SnapCell
  block: SnapBlock
  changed: Set<number>
  reads: Set<number>
}) {
  const isChanged = changed.has(cell.addr) || (cell.ptrTo !== null && changed.has(block.addr))
  const isRead = reads.has(cell.addr)
  return (
    <div
      data-addr={cell.addr}
      className={cn(
        'flex min-w-9 flex-col items-center px-1.5 py-1 transition-all duration-300',
        isChanged && 'bg-[color-mix(in_oklch,var(--accent-amber)_28%,transparent)]',
        !isChanged && isRead && 'bg-[color-mix(in_oklch,var(--accent-blue)_14%,transparent)]'
      )}
    >
      {cell.field !== undefined && (
        <span className="max-w-24 truncate text-[9.5px] font-medium text-muted-foreground">{cell.field}</span>
      )}
      <span
        className={cn(
          'font-mono text-[13px] leading-5',
          cell.value === 'null' && 'text-muted-foreground/70',
          cell.value === 'dangling' && 'text-[var(--accent-rose)] text-[10px]',
          cell.ptrTo !== null && 'text-[var(--accent-blue)]'
        )}
      >
        {cell.ptrTo !== null ? '●' : cell.value}
      </span>
      {cell.index !== undefined && (
        <span className="text-[9px] font-medium text-muted-foreground/80">{cell.index}</span>
      )}
    </div>
  )
}

function BlockBox({
  block,
  changed,
  reads,
}: {
  block: SnapBlock
  changed: Set<number>
  reads: Set<number>
}) {
  const touched = block.cells.some((c) => changed.has(c.addr)) || changed.has(block.addr)
  return (
    <div
      data-addr={block.addr}
      data-block="1"
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-[var(--card)] shadow-sm transition-all duration-300',
        block.heap
          ? 'border-[color-mix(in_oklch,var(--accent-violet)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-violet)_7%,var(--card))]'
          : 'border-border/70',
        touched && 'ring-2 ring-[var(--accent-amber)]'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 border-b px-2 py-0.5',
          block.heap ? 'border-[color-mix(in_oklch,var(--accent-violet)_35%,transparent)]' : 'border-border/50'
        )}
      >
        <span className="max-w-40 truncate text-[10.5px] font-semibold text-foreground">{block.name}</span>
        <span className="text-[9px] font-medium text-muted-foreground">{block.type}</span>
      </div>
      <div className={cn('flex items-stretch', block.kind === 'object' && 'flex-wrap')}>
        {block.cells.length === 0 && (
          <span className="px-2 py-1 text-[10px] italic text-muted-foreground">empty</span>
        )}
        {block.cells.map((c, i) => (
          <div key={c.addr} className={cn('flex', i > 0 && 'border-l border-border/40')}>
            <CellBox cell={c} block={block} changed={changed} reads={reads} />
          </div>
        ))}
      </div>
      <div className="border-t border-border/40 px-2 py-0.5 text-[8.5px] font-mono text-muted-foreground/70">
        {fmtAddr(block.addr, block.heap)}
      </div>
    </div>
  )
}

export function DsaMemoryView({ step }: { step: TraceStep | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [arrows, setArrows] = useState<Arrow[]>([])

  const recompute = useCallback(() => {
    const root = containerRef.current
    if (!root || !step) {
      setArrows([])
      return
    }
    const rootRect = root.getBoundingClientRect()
    const toLocal = (r: DOMRect) => ({
      x: r.left - rootRect.left + root.scrollLeft,
      y: r.top - rootRect.top + root.scrollTop,
      w: r.width,
      h: r.height,
    })
    // address → element (prefer cells over block headers)
    const byAddr = new Map<number, Element>()
    root.querySelectorAll('[data-block]').forEach((el) => {
      const a = Number(el.getAttribute('data-addr'))
      if (!byAddr.has(a)) byAddr.set(a, el)
    })
    root.querySelectorAll('[data-addr]:not([data-block])').forEach((el) => {
      const a = Number(el.getAttribute('data-addr'))
      byAddr.set(a, el)
    })
    const next: Arrow[] = []
    const allBlocks = [...step.frames.flatMap((f) => f.blocks), ...step.heapBlocks]
    for (const b of allBlocks) {
      for (const c of b.cells) {
        if (c.ptrTo === null) continue
        const from = byAddr.get(c.addr)
        const to = byAddr.get(c.ptrTo)
        if (!from) continue
        const fr = toLocal(from.getBoundingClientRect())
        if (!to) {
          next.push({ x1: fr.x + fr.w / 2, y1: fr.y + fr.h / 2, x2: fr.x + fr.w / 2 + 34, y2: fr.y + fr.h / 2 - 20, dangling: true })
          continue
        }
        const tr = toLocal(to.getBoundingClientRect())
        const fromRight = tr.x >= fr.x + fr.w
        next.push({
          x1: fr.x + fr.w / 2,
          y1: fr.y + fr.h / 2,
          x2: fromRight ? tr.x + 2 : tr.x + tr.w / 2,
          y2: fromRight ? tr.y + tr.h / 2 : c.ptrTo && tr.y > fr.y ? tr.y + 2 : tr.y + tr.h - 2,
          dangling: false,
        })
      }
    }
    setArrows(next)
  }, [step])

  useLayoutEffect(() => {
    recompute()
  }, [recompute])

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const onScroll = () => recompute()
    root.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => recompute())
    ro.observe(root)
    return () => {
      root.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [recompute])

  if (!step) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Run some code to see its memory here.
      </div>
    )
  }

  const changed = new Set(step.changed)
  const reads = new Set(step.reads)
  const contentW = Math.max(0, ...arrows.map((a) => Math.max(a.x1, a.x2))) + 40
  const contentH = Math.max(0, ...arrows.map((a) => Math.max(a.y1, a.y2))) + 40

  return (
    <div ref={containerRef} className="relative h-full overflow-auto p-3">
      <div className="relative flex min-w-max items-start gap-4">
        {/* stack — one card per live frame, innermost last */}
        <div className="flex min-w-56 flex-col gap-2.5">
          {step.frames.map((f, i) => (
            <div
              key={f.id}
              className={cn(
                'rounded-xl border p-2',
                i === step.frames.length - 1
                  ? 'border-[color-mix(in_oklch,var(--accent-mint)_50%,transparent)] bg-[color-mix(in_oklch,var(--accent-mint)_5%,transparent)]'
                  : 'border-border/50'
              )}
            >
              <div className="mb-1.5 flex items-baseline gap-1.5 px-0.5">
                <span className="font-mono text-[11px] font-bold text-foreground">
                  {f.fn}
                  {f.fn !== 'globals' && `(${f.args})`}
                </span>
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  {f.fn === 'globals' ? 'global scope' : 'stack frame'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {f.blocks.map((b) => (
                  <BlockBox key={b.id} block={b} changed={changed} reads={reads} />
                ))}
                {f.blocks.length === 0 && (
                  <span className="px-1 pb-1 text-[10px] italic text-muted-foreground">no variables yet</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* heap */}
        {step.heapBlocks.length > 0 && (
          <div className="rounded-xl border border-dashed border-[color-mix(in_oklch,var(--accent-violet)_45%,transparent)] p-2">
            <div className="mb-1.5 px-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--accent-violet)]">
              Heap · dynamic memory
            </div>
            <div className="flex max-w-96 flex-wrap gap-2">
              {step.heapBlocks.map((b) => (
                <BlockBox key={b.id} block={b} changed={changed} reads={reads} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* pointer arrows */}
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={Math.max(contentW, 100)}
        height={Math.max(contentH, 100)}
        style={{ overflow: 'visible' }}
      >
        <defs>
          <marker id="dsa-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent-blue)" />
          </marker>
          <marker id="dsa-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent-rose)" />
          </marker>
        </defs>
        {arrows.map((a, i) => {
          const dx = a.x2 - a.x1
          const dy = a.y2 - a.y1
          const bend = Math.min(46, Math.max(14, Math.hypot(dx, dy) * 0.3))
          const d = `M ${a.x1} ${a.y1} C ${a.x1 + bend} ${a.y1 - bend}, ${a.x2 - bend} ${a.y2 - bend}, ${a.x2} ${a.y2}`
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={a.dangling ? 'var(--accent-rose)' : 'var(--accent-blue)'}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              markerEnd={a.dangling ? 'url(#dsa-arrow-bad)' : 'url(#dsa-arrow)'}
              opacity={0.85}
            />
          )
        })}
      </svg>
    </div>
  )
}
