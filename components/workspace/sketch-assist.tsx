'use client'

// The two small pieces of UI around reading a sketch:
//   • DoneChip     — "✓ Done drawing", a fixed control at the top right of the screen; a spinner while it reads.
//   • ReadFailureCard — "Couldn't recognise this sketch", with what was seen and what to do next.
// Both live in the canvas' page-coordinate layer (they move and zoom with the drawing) and
// counter-scale so they stay a readable size.

import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { Check, Loader2, Pencil, RotateCw, Trash2 } from 'lucide-react'
import { componentById } from '@/lib/scene/factory'
import { MECH_PICK, WAVE1_CLASSES } from '@/lib/sketch/classes'
import type { ReadFailure } from '@/lib/sketch/read-sketch'
import type { Box } from '@/lib/sketch/neural-pick'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()
const labelOf = (cls: string) => componentById(cls)?.label ?? cls

/** Under the sketch, left-aligned with it (as the preview is) — or above it when there is no room below. */
function anchor(box: Box, zoom: number, above: boolean) {
  return above
    ? ({ left: box.x0, top: box.y0 - 12 / zoom, transform: `translateY(-100%) scale(${1 / zoom})`, transformOrigin: 'bottom left' } as const)
    : ({ left: box.x0, top: box.y1 + 12 / zoom, transform: `scale(${1 / zoom})`, transformOrigin: 'top left' } as const)
}

/** True when a key press should not be taken as a shortcut (the person is typing). */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/**
 * "Done drawing" — a standing control in a fixed corner of the canvas, NOT beside the ink. Beside the ink
 * it sat exactly where the next stroke (a value label, a wire) starts: a stroke begun on it was swallowed
 * and its tap counted as Done, reading the sketch mid-drawing (reproduced in the browser).
 */
export function DoneChip({
  reading,
  onDone,
  onHide,
}: {
  reading: boolean
  onDone: () => void
  onHide: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return
      // Enter on a focused button or link presses THAT control, not Done
      const onControl = (e.target as HTMLElement | null)?.closest?.('button, a, [role="button"]')
      if (e.key === 'Enter' && !reading && !onControl) { e.preventDefault(); onDone() }
      if (e.key === 'Escape') { e.preventDefault(); onHide() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone, onHide, reading])

  // The canvas draws in page space (panned and zoomed); this control belongs to the screen, so it is portalled
  // out of that layer.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="group"
      aria-label="Finish drawing"
      className="pointer-events-auto fixed right-4 top-14 z-40 flex w-max items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-1 pr-2 text-ui-sm shadow-md"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      {reading ? (
        <span role="status" className="flex items-center gap-1.5 px-2 py-0.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading your sketch…
        </span>
      ) : (
        <>
          <button
            type="button"
            className="flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--accent-blue)] px-2.5 py-1 font-medium text-white hover:opacity-90"
            onClick={onDone}
            title="Read this sketch (Enter)"
          >
            <Check className="h-3.5 w-3.5" /> Done drawing
          </button>
          <span className="hidden whitespace-nowrap text-muted-foreground sm:inline">or press Enter</span>
        </>
      )}
    </div>,
    document.body
  )
}

export function ReadFailureCard({
  failure,
  box,
  zoom,
  above = false,
  onRetry,
  onKeepDrawing,
  onRedraw,
  onChoose,
}: {
  failure: ReadFailure
  /** Where the sketch is; the card sits under it. */
  box: Box
  zoom: number
  above?: boolean
  onRetry: () => void
  onKeepDrawing: () => void
  onRedraw: () => void
  onChoose: (cls: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return
      if (e.key === 'Escape') { e.preventDefault(); onKeepDrawing() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKeepDrawing])

  const canChoose = failure.reason === 'unrecognised'
  const title = failure.reason === 'not-loaded' ? (/download/i.test(failure.message) ? 'Recogniser unavailable' : 'Recogniser still loading') : failure.reason === 'no-ink' ? 'Nothing to read' : failure.reason === 'error' ? 'Reading failed' : failure.reason === 'not-connected' ? "Couldn't connect these parts" : failure.reason === 'incomplete' ? 'Not enough for a circuit yet' : failure.reason === 'unsupported' ? "Can't build this yet" : "Couldn't recognise this sketch"

  return (
    <div
      role="dialog"
      aria-label="Sketch not recognised"
      className="pointer-events-auto absolute z-50 flex w-[320px] max-w-[85vw] flex-col gap-2 rounded-lg border border-[var(--accent-rose)] bg-card p-3 text-ui-sm shadow-lg"
      style={anchor(box, zoom, above)}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-muted-foreground">
          {failure.message}
          {failure.reason === 'unrecognised' && failure.best && (
            <> Closest guess: {labelOf(failure.best.cls)} ({Math.round(failure.best.p * 100)}%).</>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-muted" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </button>
        <button type="button" className="flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-muted" onClick={onKeepDrawing}>
          <Pencil className="h-3.5 w-3.5" /> Keep drawing
        </button>
        {canChoose && (
          <button type="button" className="flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-muted" onClick={onRedraw}>
            <Trash2 className="h-3.5 w-3.5" /> Redraw
          </button>
        )}
      </div>
      {canChoose && (
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap text-muted-foreground">It's a…</span>
          <select
            aria-label="Choose the component yourself"
            className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1"
            value=""
            onChange={(e) => e.target.value && onChoose(e.target.value)}
            onKeyDown={stop}
          >
            <option value="">Choose component…</option>
            <optgroup label="Circuits">
              {WAVE1_CLASSES.map((c) => (
                <option key={c} value={c}>{labelOf(c)}</option>
              ))}
            </optgroup>
            <optgroup label="Mechanics">
              {MECH_PICK.map((c) => (
                <option key={c} value={c}>{labelOf(c)}</option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
      {canChoose && (
        <p className="text-muted-foreground">Choosing one saves your correction on this device only, to help it learn your handwriting.</p>
      )}
    </div>
  )
}
