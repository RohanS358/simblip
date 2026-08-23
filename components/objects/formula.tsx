'use client'

// Formula card. Write `f(x) = x^2 + 3*x, 10<x<20` (bounds optional, several
// variables → partials) — the calculus actions (d/dx, ∂/∂x, ∫dx, Laplace,
// Fourier) live in the Properties panel once selected, and the worked,
// step-by-step solution renders inside the card.

import { useMemo, useState } from 'react'
// katex-impl carries the stylesheet with it. This module is only ever
// reached through OBJECT_RENDERERS' dynamic import, so importing it eagerly
// here is fine — and unlike text objects, a formula object exists to show
// maths, so it should not flash literal source while a chunk loads.
import katex from '@/lib/text/katex-impl'
import { useDocStore } from '@/lib/store/document'
import { parseFormula } from '@/lib/formula/steps'
import { cn } from '@/lib/utils'
import { getString, type ObjectRendererProps } from './types'

export function FormulaObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const [editing, setEditing] = useState(false)
  const latex = getString(object, 'latex')
  const solution = getString(object, 'solution')

  const parsed = useMemo(() => parseFormula(latex), [latex])

  const html = useMemo(() => {
    try {
      return katex.renderToString(latex || '\\text{empty}', { displayMode: true, throwOnError: false })
    } catch {
      return '<span>Invalid LaTeX</span>'
    }
  }, [latex])

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
        <input
          autoFocus
          aria-label="LaTeX expression"
          className="w-full bg-transparent font-mono text-base outline-none md:text-[13px]"
          value={latex}
          onChange={(e) => setStringParam(pageId, object.id, 'latex', e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') setEditing(false)
            e.stopPropagation()
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          aria-label="Edit formula"
          className="cursor-text text-left [&_.katex-display]:my-0"
          onDoubleClick={() => {
            pushHistory(pageId)
            setEditing(true)
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
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
            ? 'double-click to edit — solve it from the Properties panel'
            : 'double-click to edit — write f(x) = x^2 + 3*x, 10<x<20 to unlock solving'}
        </p>
      )}
    </div>
  )
}
