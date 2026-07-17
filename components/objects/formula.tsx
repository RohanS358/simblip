'use client'

// Formula card. Write `f(x) = x^2 + 3*x, 10<x<20` (bounds optional, several
// variables → partials) and a floating action bar offers d/dx, ∂/∂x and ∫dx
// per variable — the worked, step-by-step solution renders inside the card.

import { useMemo, useState } from 'react'
import katex from 'katex'
import { Info, X } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  parseFormula,
  derivativeSteps,
  integralSteps,
  iteratedIntegralSteps,
  laplaceSteps,
  fourierSteps,
} from '@/lib/formula/steps'
import { getString, type ObjectRendererProps } from './types'

const BTN =
  'rounded-lg px-2 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

function ToolInfo({ description }: { description: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Tool info"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-56 text-xs leading-relaxed">
        {description}
      </PopoverContent>
    </Popover>
  )
}

function ToolAction({
  children,
  description,
  onClick,
}: {
  children: React.ReactNode
  description: string
  onClick: () => void
}) {
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" className={BTN} onClick={onClick}>
        {children}
      </button>
      <ToolInfo description={description} />
    </span>
  )
}

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

  const boundedVars = parsed ? parsed.vars.filter((v) => parsed.bounds[v]) : []

  const solve = (kind: 'd' | 'i' | 'ii' | 'L' | 'F', v?: string) => {
    if (!parsed) return
    pushHistory(pageId)
    try {
      const steps =
        kind === 'd'
          ? derivativeSteps(parsed, v!)
          : kind === 'ii'
            ? iteratedIntegralSteps(parsed)
            : kind === 'L'
              ? laplaceSteps(parsed, v!)
              : kind === 'F'
                ? fourierSteps(parsed, v!)
                : integralSteps(parsed, v!)
      setStringParam(pageId, object.id, 'solution', steps)
    } catch {
      setStringParam(pageId, object.id, 'solution', `\\text{could not solve — check the expression}`)
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col justify-center rounded-xl bg-card/60 p-3 hairline">
      {/* Calculus action bar — shows once the text parses as f(x) = … */}
      {selected && !editing && parsed && (
        <div
          className="glass-strong absolute -top-11 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-xl p-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {parsed.vars.map((v) => (
            <ToolAction
              key={`d${v}`}
              description={`Differentiate the expression with respect to ${v}.`}
              onClick={() => solve('d', v)}
            >
              {parsed.vars.length > 1 ? `∂/∂${v}` : `d/d${v}`}
            </ToolAction>
          ))}
          {parsed.vars.map((v) => (
            <ToolAction
              key={`i${v}`}
              description={
                parsed.bounds[v]
                  ? `Compute a definite integral from ${parsed.bounds[v][0]} to ${parsed.bounds[v][1]} with respect to ${v}.`
                  : `Compute an indefinite integral with respect to ${v}.`
              }
              onClick={() => solve('i', v)}
            >
              ∫d{v}
            </ToolAction>
          ))}
          {boundedVars.length > 1 && (
            <ToolAction
              description={`Compute an iterated integral over ${boundedVars.join(', ')}.`}
              onClick={() => solve('ii')}
            >
              {boundedVars.length > 2 ? '∭' : '∬'}
            </ToolAction>
          )}
          <span className="mx-0.5 h-4 w-px bg-border" />
          {parsed.vars.map((v) => (
            <ToolAction
              key={`L${v}`}
              description={`Compute the Laplace transform in ${v} to rewrite the expression in the frequency domain.`}
              onClick={() => solve('L', v)}
            >
              L{parsed.vars.length > 1 ? `{${v}}` : ''}
            </ToolAction>
          ))}
          {parsed.vars.map((v) => (
            <ToolAction
              key={`F${v}`}
              description={`Compute the Fourier transform in ${v} to analyze the expression by frequency.`}
              onClick={() => solve('F', v)}
            >
              F{parsed.vars.length > 1 ? `{${v}}` : ''}
            </ToolAction>
          ))}
          {solution && (
            <button
              type="button"
              aria-label="Clear solution"
              className="rounded-lg p-1 text-muted-foreground hover:text-[var(--accent-rose)]"
              onClick={() => {
                pushHistory(pageId)
                setStringParam(pageId, object.id, 'solution', '')
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {editing ? (
        <input
          autoFocus
          aria-label="LaTeX expression"
          className="w-full bg-transparent font-mono text-[13px] outline-none"
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
          className="mt-2 min-h-0 overflow-y-auto border-t border-border/60 pt-2 text-[13px] [&_.katex-display]:my-0"
          aria-label="Worked solution"
          dangerouslySetInnerHTML={{ __html: solHtml }}
        />
      )}

      {selected && !editing && (
        <p className="mt-1 text-center text-[10.5px] text-muted-foreground">
          {parsed
            ? 'double-click to edit — use the bar above to solve'
            : 'double-click to edit — write f(x) = x^2 + 3*x, 10<x<20 to unlock solving'}
        </p>
      )}
    </div>
  )
}
