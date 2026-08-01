'use client'

// DSA Lab — write C++ on the left, watch it execute on the right.
// The code is re-interpreted on every edit (lib/dsa/interpreter.ts) into a
// step trace; the transport replays it: memory blocks with real addresses,
// dotted pointer arrows, a growing recursion tree and measured complexity
// analysis. The current source line stays highlighted in the editor.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { runCpp } from '@/lib/dsa/interpreter'
import { DEFAULT_DSA_SOURCE } from '@/lib/dsa/samples'
import type { TraceResult } from '@/lib/dsa/trace'
import { cn } from '@/lib/utils'
import { getString, type ObjectRendererProps } from './types'
import { DsaMemoryView } from './dsa-memory'
import { DsaGraphView } from './dsa-graph'
import { DsaTreeView } from './dsa-tree'
import { DsaAnalysisView } from './dsa-analysis'

const LH = 19 // editor line height (px) — keep in sync with the classes below
const PAD_T = 8
const SPEEDS = [0.5, 1, 2, 4, 8]

const KIND_COLOR: Record<string, string> = {
  assign: 'var(--accent-amber)',
  decl: 'var(--accent-amber)',
  compare: 'var(--accent-blue)',
  call: 'var(--accent-mint)',
  return: 'var(--accent-mint)',
  alloc: 'var(--accent-violet)',
  free: 'var(--accent-violet)',
  io: 'var(--accent-blue)',
  flow: 'var(--muted-foreground)',
  error: 'var(--accent-rose)',
}

type Tab = 'memory' | 'graph' | 'tree' | 'analysis'

export function DsaObject({ pageId, object }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const source = getString(object, 'source', DEFAULT_DSA_SOURCE)
  const stdin = getString(object, 'stdin', '')

  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(2) // 2×
  const [tab, setTab] = useState<Tab>('memory')
  const [scrollTop, setScrollTop] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editorRatio, setEditorRatio] = useState(44) // percentage width for editor panel
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const firstRun = useRef(true)

  // Re-interpret on every change, debounced — the "live interpreter" feel.
  useEffect(() => {
    const t = setTimeout(() => {
      const result = runCpp(source, stdin)
      setTrace(result)
      setStepIdx(0)
      setPlaying(false)
      firstRun.current = false
    }, firstRun.current ? 0 : 500)
    return () => clearTimeout(t)
  }, [source, stdin])

  const maxStep = Math.max(0, (trace?.steps.length ?? 0) - 1)
  const step = trace && trace.steps.length > 0 ? trace.steps[Math.min(stepIdx, maxStep)] : null

  // transport clock
  useEffect(() => {
    if (!playing || !trace) return
    const iv = setInterval(() => {
      setStepIdx((i) => {
        if (i >= maxStep) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 650 / SPEEDS[speedIdx])
    return () => clearInterval(iv)
  }, [playing, speedIdx, trace, maxStep])

  const lines = useMemo(() => source.split('\n'), [source])
  const activeLine = step?.line ?? 0
  const errorLine = trace?.error?.line ?? 0

  const restart = () => {
    setStepIdx(0)
    setPlaying(false)
  }

  // Resizable splitter between editor and visualization panels.
  // Uses getBoundingClientRect() for the container width so the delta is in
  // real screen pixels — object.size.w is scene-space and is off by zoom.
  // Pointer Events (not mouse events): a touch drag never fires mousedown,
  // so on mobile/tablet the old mouse-only handler let the gesture fall
  // through to the canvas, which dragged the whole window instead of
  // resizing the split. setPointerCapture keeps the drag on this handle
  // even if the finger wanders off its thin hit target.
  const handleSplitterPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startRatio = editorRatio
    // Snapshot the rendered pixel width at drag-start time.
    const containerW = containerRef.current?.getBoundingClientRect().width || object.size.w || 980

    const onPointerMove = (moveEvt: PointerEvent) => {
      const deltaPercent = ((moveEvt.clientX - startX) / containerW) * 100
      setEditorRatio(Math.max(20, Math.min(80, startRatio + deltaPercent)))
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-[var(--background)] shadow-sm">
      {/* ── header: title (drag handle) + transport ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-1.5">
        <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">DSA Lab</span>
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            trace?.error ? 'bg-[var(--accent-rose)]' : playing ? 'bg-[var(--accent-mint)]' : 'bg-muted-foreground/40'
          )}
        />
        <div className="flex-1" />
        <div
          className="flex items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" aria-label="Restart" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={restart}>
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Step back"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              setPlaying(false)
              setStepIdx((i) => Math.max(0, i - 1))
            }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            className="rounded-md bg-[var(--accent-blue)] p-1 text-white hover:bg-blue-600"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          </button>
          <button
            type="button"
            aria-label="Step forward"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              setPlaying(false)
              setStepIdx((i) => Math.min(maxStep, i + 1))
            }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="w-9 rounded-md px-1 py-0.5 text-center font-mono text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
            title="Playback speed"
          >
            {SPEEDS[speedIdx]}×
          </button>
          <input
            type="range"
            min={0}
            max={maxStep}
            value={Math.min(stepIdx, maxStep)}
            className="h-1 w-24 accent-[var(--accent-blue)]"
            onChange={(e) => {
              setPlaying(false)
              setStepIdx(Number(e.target.value))
            }}
          />
          <span className="w-16 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {trace ? `${Math.min(stepIdx, maxStep) + 1} / ${maxStep + 1}` : '— / —'}
          </span>
        </div>
      </div>

      {/* ── body ── */}
      <div
        className="flex min-h-0 flex-1"
        onPointerDown={(e) => {
          if (editing) e.stopPropagation()
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* editor */}
        <div
          className="relative min-h-0 shrink-0 overflow-hidden border-r border-border/40"
          style={{ width: `${editorRatio}%` }}
        >
          {/* current-line highlight */}
          {activeLine > 0 && !trace?.error && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-0 bg-[color-mix(in_oklch,var(--accent-mint)_16%,transparent)] transition-[top] duration-150"
              style={{ top: PAD_T + (activeLine - 1) * LH - scrollTop, height: LH }}
            />
          )}
          {errorLine > 0 && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-0 bg-[color-mix(in_oklch,var(--accent-rose)_16%,transparent)]"
              style={{ top: PAD_T + (errorLine - 1) * LH - scrollTop, height: LH }}
            />
          )}
          {/* gutter */}
          <div
            className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-8 select-none border-r border-border/30 bg-muted/10 pt-2 text-right"
            aria-hidden
          >
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
              {lines.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'pr-1.5 font-mono text-[10px] leading-[19px] text-muted-foreground/60',
                    i + 1 === activeLine && 'font-bold text-[var(--accent-mint)]',
                    i + 1 === errorLine && 'font-bold text-[var(--accent-rose)]'
                  )}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
          <textarea
            ref={editorRef}
            className="absolute inset-0 z-[5] resize-none whitespace-pre bg-transparent py-2 pl-10 pr-2 font-mono text-[13px] leading-[19px] text-foreground focus:outline-none"
            value={source}
            wrap="off"
            spellCheck={false}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
              if (!editing) pushHistory(pageId)
              setStringParam(pageId, object.id, 'source', e.target.value)
              setEditing(true)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.currentTarget.blur()
                return
              }
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart, selectionEnd, value } = el
                const next = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd)
                setStringParam(pageId, object.id, 'source', next)
                requestAnimationFrame(() => {
                  el.selectionStart = el.selectionEnd = selectionStart + 2
                })
              }
            }}
          />
        </div>

        {/* Resizable Section Splitter */}
        <div
          onPointerDown={handleSplitterPointerDown}
          className="relative z-20 w-1.5 shrink-0 touch-none cursor-col-resize bg-border/40 transition-colors hover:bg-[var(--accent-blue)]/60"
          title="Drag to resize panels"
        />

        {/* visualization */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" onPointerDown={(e) => e.stopPropagation()}>
          {/* tabs + step description */}
          <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1">
            {(
              [
                ['memory', 'Memory'],
                ['graph', 'Graph'],
                ['tree', 'Recursion Tree'],
                ['analysis', 'Analysis'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                  tab === id
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
            <div className="min-w-0 flex-1" />
            {step && (
              <span
                className="min-w-0 truncate font-mono text-[11px]"
                style={{ color: KIND_COLOR[step.kind] ?? 'var(--muted-foreground)' }}
                title={step.desc}
              >
                {step.desc}
              </span>
            )}
          </div>

          {/* cin reads sequentially from here — whitespace-separated tokens,
              same convention real stdin redirection uses. */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border/40 bg-muted/10 px-2 py-1">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Input
            </span>
            <input
              type="text"
              value={stdin}
              onChange={(e) => setStringParam(pageId, object.id, 'stdin', e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="values for cin, space-separated — e.g. 5 hello 3.25"
              aria-label="Program input (stdin) for cin"
              className="min-w-0 flex-1 rounded-md border border-border/50 bg-background/60 px-2 py-0.5 font-mono text-[11px] text-foreground outline-none focus:border-[var(--ring)]"
            />
          </div>

          <div className="min-h-0 flex-1">
            {tab === 'memory' && <DsaMemoryView step={step} />}
            {tab === 'graph' && <DsaGraphView step={step} />}
            {tab === 'tree' && <DsaTreeView trace={trace} stepIdx={Math.min(stepIdx, maxStep)} />}
            {tab === 'analysis' && <DsaAnalysisView trace={trace} />}
          </div>

          {/* console */}
          {(step?.output || trace?.error || trace?.truncated) && (
            <div className="max-h-20 shrink-0 overflow-auto border-t border-border/40 bg-muted/15 px-2.5 py-1.5">
              {step?.output && (
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug text-foreground">{step.output}</pre>
              )}
              {trace?.error && (
                <p className="font-mono text-[11px] leading-snug text-[var(--accent-rose)]">
                  {trace.error.line > 0 ? `line ${trace.error.line}: ` : ''}
                  {trace.error.message}
                </p>
              )}
              {trace?.truncated && (
                <p className="text-[10px] italic text-muted-foreground">
                  Trace truncated — the animation shows the first {trace.steps.length} steps. Use a smaller input to see it all.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
