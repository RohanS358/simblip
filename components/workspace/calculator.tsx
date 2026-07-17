'use client'

// A sticky mini calculator. It floats above the canvas, can be dragged
// anywhere, and stays put across page switches — you keep it open while you
// work, the way you'd keep a real calculator on the desk.
//
// The maths is mathjs (the same engine the formula fields use), so anything
// valid in a formula is valid here: sqrt(2), sin(pi/4), 3^4, log(100, 10),
// and page variables are NOT in scope on purpose — this is scratch arithmetic,
// not part of the document.
//
// Size follows notebook Components UI scale, and the frame itself is
// resizable from the bottom-right corner.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { X, Delete, GripHorizontal } from 'lucide-react'
import { create, all } from 'mathjs'
import { fmtNum } from '@/lib/scene/format'
import { usePrefs } from '@/lib/store/preferences'
import { cn } from '@/lib/utils'

const math = create(all, {})

const MIN_W = 200
const MAX_W = 420
const DEFAULT_W = 256 // w-64

// Where the calculator sits, remembered across open/close and page switches
// so it reopens exactly where you left it — never at a surprise position.
let savedPos: { x: number; y: number } | null = null
let savedWidth = DEFAULT_W

/** Keep the frame on screen no matter what resized underneath it. */
const clampPos = (x: number, y: number, w: number, scale: number) => ({
  x: Math.min(Math.max(8, window.innerWidth - w * scale - 8), Math.max(8, x)),
  y: Math.min(window.innerHeight - 120, Math.max(8, y)),
})

/** Scientific keys — a second row set, hidden until you ask for them. */
const SCI = [
  ['sin(', 'cos(', 'tan(', 'π'],
  ['√(', 'ln(', 'log10(', 'e'],
  ['^', '(', ')', '!'],
]

const BASIC = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', '.', '=', '+'],
]

/** What the user types vs. what mathjs understands. */
const toExpr = (s: string) =>
  s.replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt')

export function Calculator({ onClose }: { onClose: () => void }) {
  const componentScale = usePrefs((s) => s.notebook.componentScale ?? 1)
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState('')
  const [sci, setSci] = useState(false)
  const [history, setHistory] = useState<{ expr: string; value: string }[]>([])
  const [width, setWidth] = useState(savedWidth)
  // Positioned from the top-left in plain screen px — the draggable outer
  // frame is NOT zoomed (only the inner body is), so drag math is exact.
  const [pos, setPos] = useState(() =>
    savedPos ??
    (typeof window === 'undefined'
      ? { x: 24, y: 120 }
      : clampPos(window.innerWidth - savedWidth * componentScale - 24, window.innerHeight - 480, savedWidth, componentScale))
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)

  // Remember placement, and never let a window resize strand it off screen.
  useEffect(() => {
    savedPos = pos
    savedWidth = width
  }, [pos, width])
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p.x, p.y, width, componentScale))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [width, componentScale])

  const onDragPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The fx / close buttons live inside the grip row — capturing their
    // pointer here would eat their clicks entirely.
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, x: pos.x, y: pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDragPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setPos(clampPos(d.x + e.clientX - d.startX, d.y + e.clientY - d.startY, width, componentScale))
  }
  const onDragPointerUp = () => {
    dragRef.current = null
  }

  // Live preview of the answer as you type — you see the result before you
  // commit, which catches a mistyped bracket immediately.
  useEffect(() => {
    if (!expr.trim()) {
      setResult('')
      return
    }
    try {
      const v = math.evaluate(toExpr(expr))
      setResult(typeof v === 'number' && Number.isFinite(v) ? fmtNum(v) : '')
    } catch {
      setResult('')
    }
  }, [expr])

  const commit = () => {
    if (!expr.trim() || !result) return
    setHistory((h) => [{ expr, value: result }, ...h].slice(0, 30))
    setExpr(result)
    inputRef.current?.focus()
  }

  const press = (k: string) => {
    if (k === '=') return commit()
    setExpr((e) => e + k)
    inputRef.current?.focus()
  }

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current
    if (!r) return
    // Divide by Components UI zoom so the drag distance matches the visual edge.
    const scale = componentScale || 1
    const next = Math.min(MAX_W, Math.max(MIN_W, r.startW + (e.clientX - r.startX) / scale))
    setWidth(next)
  }

  const onResizePointerUp = () => {
    resizeRef.current = null
  }

  const OPS = new Set(['÷', '×', '−', '+', '^'])
  const key = (k: string) => (
    <button
      key={k}
      type="button"
      className={cn(
        'rounded-xl py-2.5 text-[13.5px] font-semibold transition-[transform,background-color] duration-100 active:scale-95',
        k === '='
          ? 'bg-[var(--accent-blue)] text-white shadow-[0_2px_10px_-2px_var(--accent-blue)]'
          : OPS.has(k)
            ? 'bg-[var(--accent-blue)]/12 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20'
            : 'bg-background/55 hover:bg-accent'
      )}
      onClick={() => press(k)}
    >
      {k}
    </button>
  )

  return (
    // Two layers on purpose: the OUTER frame owns position in plain screen px
    // (drag math stays 1:1 with the pointer), the INNER body owns width and
    // the Components UI zoom — same scale as canvas objects.
    <div
      className="fixed z-50 select-none"
      style={{ left: pos.x, top: pos.y, animation: 'calc-in 160ms ease-out' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
    <div
      className="liquid-glass relative rounded-[1.4rem] p-2.5"
      style={{ width, zoom: componentScale !== 1 ? componentScale : undefined }}
    >
      <style>{`@keyframes calc-in { from { opacity: 0; transform: scale(.96) } }`}</style>
      <div
        className="mb-1 flex cursor-grab touch-none items-center gap-1 active:cursor-grabbing"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
      >
        <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Calculator
        </span>
        <button
          type="button"
          aria-label="Scientific keys"
          aria-pressed={sci}
          className={cn(
            'rounded px-1.5 text-[10px] font-bold',
            sci ? 'text-[var(--accent-blue)]' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setSci((v) => !v)}
        >
          fx
        </button>
        <button
          type="button"
          aria-label="Close calculator"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Typing works on desktop — the keypad is a convenience, not the only way in.
           On touch devices we suppress the virtual keyboard (inputMode=none)
           so the keypad is the input method; the field is still selectable
           for copy. */}
      <input
        ref={inputRef}
        aria-label="Expression"
        className="w-full rounded-lg bg-transparent px-2 pt-1 text-right font-mono text-[13px] text-muted-foreground outline-none select-all"
        style={{ touchAction: 'auto', caretColor: 'transparent' }}
        value={expr}
        placeholder="0"
        readOnly
        inputMode="none"
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation() // the canvas has single-key tool shortcuts
          if (e.key === 'Enter') commit()
          else if (e.key === 'Backspace') setExpr((s) => s.slice(0, -1))
          else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey)
            setExpr((s) => s + e.key)
        }}
      />
      <div className="mb-1.5 flex min-h-8 items-center justify-end gap-1.5 px-2">
        <span className="truncate font-mono text-[22px] font-semibold tracking-tight">
          {result || (expr ? '' : '0')}
        </span>
        {expr && (
          <button
            type="button"
            aria-label="Backspace"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setExpr((s) => s.slice(0, -1))}
          >
            <Delete className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {sci && (
        <div className="mb-1 grid grid-cols-4 gap-1.5">
          {SCI.flat().map(key)}
        </div>
      )}
      <div className="grid grid-cols-4 gap-1.5">{BASIC.flat().map(key)}</div>

      <button
        type="button"
        className="mt-1 w-full rounded-lg py-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => {
          setExpr('')
          setResult('')
        }}
      >
        Clear
      </button>

      {history.length > 0 && (
        <div className="mt-1 max-h-24 overflow-y-auto border-t border-border/60 pt-1">
          {history.map((h, i) => (
            <button
              key={i}
              type="button"
              className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
              title="Reuse this result"
              onClick={() => setExpr(h.value)}
            >
              <span className="truncate font-mono text-[10px] text-muted-foreground">{h.expr}</span>
              <span className="shrink-0 font-mono text-[11px]">{h.value}</span>
            </button>
          ))}
        </div>
      )}

      {/* Resize handle — bottom-right corner; drag to widen the keypad. */}
      <div
        role="separator"
        aria-label="Resize calculator"
        aria-orientation="horizontal"
        className="absolute bottom-1 right-1 h-3.5 w-3.5 cursor-se-resize touch-none rounded-sm"
        style={{
          background:
            'linear-gradient(135deg, transparent 50%, color-mix(in oklch, var(--muted-foreground) 45%, transparent) 50%)',
        }}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />
    </div>
    </div>
  )
}
