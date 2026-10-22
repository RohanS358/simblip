'use client'

// Formula card. Write `f(x) = x^2 + 3*x, 10<x<20` (bounds optional, several
// variables → partials) — the calculus actions (d/dx, ∂/∂x, ∫dx, Laplace,
// Fourier) live in the Properties panel once selected, and the worked,
// step-by-step solution renders inside the card.
//
// A card can hold SEVERAL formulas: one per line. Each line is typeset on its own, centred, and
// the card grows to fit them. (The calculus actions work on the first line.) A lesson writes the
// formulas it teaches into one card, adding a line at a time.

import { useMemo, useState } from 'react'
// katex-impl carries the stylesheet with it. This module is only ever
// reached through OBJECT_RENDERERS' dynamic import, so importing it eagerly
// here is fine — and unlike text objects, a formula object exists to show
// maths, so it should not flash literal source while a chunk loads.
import katex from '@/lib/text/katex-impl'
import { useDocStore } from '@/lib/store/document'
import { parseFormula } from '@/lib/formula/steps'
import { cn } from '@/lib/utils'
import { getNumber, getString, type ObjectRendererProps } from './types'

export function FormulaObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const [editing, setEditing] = useState(false)
  const latex = getString(object, 'latex')
  const solution = getString(object, 'solution')
  // Set by the lesson player while it narrates the formula, and cleared when the line is done.
  const writeMs = getNumber(object, 'writeMs', 0)
  // Which line is being written out (the others are already on the board).
  const writeLine = getNumber(object, 'writeLine', -1)

  const lines = useMemo(() => {
    const l = latex.split('\n').map((x) => x.trim()).filter((x, i, a) => x || a.length === 1)
    return l.length ? l : ['']
  }, [latex])
  const parsed = useMemo(() => parseFormula(lines[0]), [lines])

  const htmls = useMemo(
    () =>
      lines.map((l) => {
        try {
          return katex.renderToString(l || '\\text{empty}', { displayMode: true, throwOnError: false })
        } catch {
          return '<span>Invalid LaTeX</span>'
        }
      }),
    [lines]
  )

  const solHtml = useMemo(() => {
    if (!solution) return ''
    try {
      return katex.renderToString(`\\begin{gathered}${solution}\\end{gathered}`, {
        displayMode: true,
        throwOnError: false,
      })
    } catch {
      return '<span>Could not render the solution</span>'
    }
  }, [solution])

  return (
    // min-h-full (not h-full) once a solution renders: the card grows past
    // its stored size to fit the worked steps instead of scrolling them
    // inside a fixed box, then drops back to its stored height the moment
    // the solution is cleared — nothing here persists the taller size.
    <div
      className={cn(
        'relative flex w-full flex-col rounded-xl bg-card/60 p-3 hairline',
        solution && !editing ? 'min-h-full justify-start' : 'h-full justify-center'
      )}
    >
      {editing ? (
        <textarea
          autoFocus
          aria-label="LaTeX expression — one formula per line"
          rows={Math.max(2, lines.length)}
          className="w-full resize-none bg-transparent font-mono text-base outline-none md:text-[13px]"
          value={latex}
          onChange={(e) => setStringParam(pageId, object.id, 'latex', e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            // Enter starts the next formula; Ctrl/Cmd+Enter or Escape finishes.
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) setEditing(false)
            e.stopPropagation()
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {htmls.map((h, i) => (
            <button
              key={i}
              type="button"
              aria-label={lines.length > 1 ? `Edit formulas (line ${i + 1})` : 'Edit formula'}
              className={cn('block w-full cursor-text text-left [&_.katex-display]:my-0', writeMs > 0 && (writeLine < 0 || i === writeLine) && 'formula-writing')}
              style={writeMs > 0 && (writeLine < 0 || i === writeLine) ? { animation: `formula-write ${writeMs}ms cubic-bezier(0.3, 0, 0.2, 1) both` } : undefined}
              onDoubleClick={() => {
                pushHistory(pageId)
                setEditing(true)
              }}
              dangerouslySetInnerHTML={{ __html: h }}
            />
          ))}
        </div>
      )}

      {solution && !editing && (
        <div
          className="mt-2 border-t border-border/60 pt-2 text-[13px] [&_.katex-display]:my-0"
          aria-label="Worked solution"
          dangerouslySetInnerHTML={{ __html: solHtml }}
        />
      )}

      {selected && !editing && (
        <p className="mt-1 text-center text-[10.5px] text-muted-foreground">
          {parsed
            ? 'double-click to edit — one formula per line; solve the first from the Properties panel'
            : 'double-click to edit — write f(x) = x^2 + 3*x, 10<x<20 to unlock solving'}
        </p>
      )}
    </div>
  )
}
