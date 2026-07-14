'use client'

// A sticky mini calculator. It floats above the canvas, can be dragged
// anywhere, and stays put across page switches — you keep it open while you
// work, the way you'd keep a real calculator on the desk.
//
// The maths is mathjs (the same engine the formula fields use), so anything
// valid in a formula is valid here: sqrt(2), sin(pi/4), 3^4, log(100, 10),
// and page variables are NOT in scope on purpose — this is scratch arithmetic,
// not part of the document.

import { useEffect, useRef, useState } from 'react'
import { motion as fm } from 'framer-motion'
import { X, Delete, GripHorizontal } from 'lucide-react'
import { create, all } from 'mathjs'
import { useSpring } from '@/lib/motion'
import { fmtNum } from '@/lib/scene/format'
import { cn } from '@/lib/utils'

const math = create(all, {})

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
  const spring = useSpring('snap')
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState('')
  const [sci, setSci] = useState(false)
  const [history, setHistory] = useState<{ expr: string; value: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

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

  const key = (k: string) => (
    <button
      key={k}
      type="button"
      className={cn(
        'rounded-lg py-2 text-[13px] font-semibold transition-colors',
        k === '=' ? 'bg-[var(--accent-blue)] text-white' : 'bg-accent/60 hover:bg-accent'
      )}
      onClick={() => press(k)}
    >
      {k}
    </button>
  )

  return (
    <fm.div
      drag
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
      className="glass-strong absolute bottom-24 right-6 z-50 w-60 select-none rounded-2xl p-2 shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex cursor-grab items-center gap-1 active:cursor-grabbing">
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
        className="w-full rounded-lg bg-background/70 px-2 py-1.5 text-right font-mono text-[14px] outline-none select-all"
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
      <div className="flex h-5 items-center justify-end gap-1 px-2">
        <span className="truncate font-mono text-[12px] text-[var(--accent-mint)]">{result}</span>
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
        <div className="mb-1 grid grid-cols-4 gap-1">
          {SCI.flat().map(key)}
        </div>
      )}
      <div className="grid grid-cols-4 gap-1">{BASIC.flat().map(key)}</div>

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
    </fm.div>
  )
}
