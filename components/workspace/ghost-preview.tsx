'use client'

// The ghost preview: what SketchNet thinks a held symbol is, drawn translucent
// over the user's own ink, with a confidence dot and the controls to confirm,
// correct, rotate or dismiss it. Nothing replaces the ink until "Make it live".
//
// Lives in the canvas' page-coordinate layer, so it moves and zooms with the
// drawing; the control chip counter-scales so it stays a readable size.

import { useEffect, useMemo } from 'react'
import { Check, RotateCw, X } from 'lucide-react'
import { componentById } from '@/lib/scene/factory'
import { MECH_PICK, WAVE1_CLASSES } from '@/lib/sketch/classes'
import { confidenceOf, ghostSize, needsChoice, type Ghost } from '@/lib/sketch/ghost'
import { SymbolIcon } from '@/components/objects/geometry'

const DOT: Record<ReturnType<typeof confidenceOf>, string> = {
  high: 'var(--accent-mint)',
  medium: 'var(--accent-amber)',
  low: 'var(--accent-rose)',
  chosen: 'var(--accent-blue)',
}

const labelOf = (cls: string) => componentById(cls)?.label ?? cls

export function GhostPreview({
  ghost,
  zoom,
  onChange,
  onConfirm,
  onDismiss,
}: {
  ghost: Ghost
  zoom: number
  onChange: (patch: Partial<Ghost>) => void
  onConfirm: () => void
  onDismiss: () => void
}) {
  // The part exactly as it would be placed, built the same way the canvas builds it.
  const part = useMemo(() => {
    const def = componentById(ghost.cls)
    if (!def) return null
    const o = def.create({ x: 0, y: 0 })
    const { w, h } = ghostSize(ghost.box, o.geometry.kind === 'symbol')
    o.size = { w, h }
    return o
  }, [ghost.cls, ghost.box])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      // an uncertain guess is never placed by a bare Enter: the person picks the part first
      if (e.key === 'Enter') { e.preventDefault(); if (!needsChoice(ghost)) onConfirm() }
      if (e.key === 'Escape') { e.preventDefault(); onDismiss() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onDismiss, ghost])

  // Other choices: the model's own first guess (so a mistaken pick can be undone),
  // then its runners-up — leaving out noise below 3 %. "Other…" covers the rest.
  const choices = useMemo(() => {
    const list: Array<{ cls: string; p: number }> = []
    if (ghost.predicted !== ghost.cls) list.push({ cls: ghost.predicted, p: ghost.predictedP })
    for (const a of ghost.alts) if (a.cls !== ghost.cls && a.p >= 0.03 && !list.some((l) => l.cls === a.cls)) list.push(a)
    return list.slice(0, 2)
  }, [ghost.cls, ghost.predicted, ghost.predictedP, ghost.alts])

  if (!part) return null
  const cx = (ghost.box.x0 + ghost.box.x1) / 2
  const cy = (ghost.box.y0 + ghost.box.y1) / 2
  const conf = confidenceOf(ghost.p)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <>
      {/* The translucent part, centred over the ink it would replace. */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: cx - part.size.w / 2,
          top: cy - part.size.h / 2,
          width: part.size.w,
          height: part.size.h,
          opacity: 0.6,
          transform: `rotate(${ghost.pose}deg)`,
          color: DOT[conf],
        }}
      >
        <SymbolIcon obj={part} pins={false} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-md border border-dashed"
        style={{
          left: Math.min(ghost.box.x0, cx - part.size.w / 2) - 6,
          top: Math.min(ghost.box.y0, cy - part.size.h / 2) - 6,
          width: Math.max(ghost.box.x1 - ghost.box.x0, part.size.w) + 12,
          height: Math.max(ghost.box.y1 - ghost.box.y0, part.size.h) + 12,
          borderColor: DOT[conf],
        }}
      />

      <div
        role="dialog"
        aria-label="Confirm recognised symbol"
        className="pointer-events-auto absolute z-50 flex w-max max-w-[360px] flex-col gap-1.5 rounded-lg border border-border bg-card p-2 text-ui-sm shadow-lg"
        style={{
          left: Math.min(ghost.box.x0, cx - part.size.w / 2),
          top: Math.max(ghost.box.y1, cy + part.size.h / 2) + 14 / zoom,
          transform: `scale(${1 / zoom})`,
          transformOrigin: 'top left',
        }}
        onPointerDown={stop}
        onPointerUp={stop}
        onClick={stop}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: DOT[conf] }}
            title={conf === 'chosen' ? 'You chose this' : conf === 'high' ? 'Confident' : conf === 'medium' ? 'Fairly sure' : 'Unsure — check it'}
          />
          <span className="whitespace-nowrap font-medium">{needsChoice(ghost) ? `Maybe ${labelOf(ghost.cls)}` : labelOf(ghost.cls)}</span>
          <span className="whitespace-nowrap text-muted-foreground">{ghost.p === null ? 'your choice' : `${Math.round(ghost.p * 100)}%`}</span>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label="Rotate 90 degrees"
              title="Rotate"
              className="rounded p-1 hover:bg-muted"
              onClick={() => onChange({ pose: (((ghost.pose + 90) % 360) as Ghost['pose']), rotated: true })}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Keep as ink"
              title="Keep as ink (Esc)"
              className="rounded p-1 hover:bg-muted"
              onClick={onDismiss}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={needsChoice(ghost)}
              title={needsChoice(ghost) ? 'Not sure yet — choose the part below' : undefined}
              className="flex items-center gap-1 whitespace-nowrap rounded bg-[var(--accent-blue)] px-2 py-1 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onConfirm}
            >
              <Check className="h-3.5 w-3.5" /> Make it live
            </button>
          </span>
        </div>

        {needsChoice(ghost) && (
          <p role="alert" className="text-[var(--accent-amber)]">
            Not sure what this is — it may be several parts, or not a symbol I know. Pick the right part to place it.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <span className="whitespace-nowrap text-muted-foreground">{needsChoice(ghost) ? 'Is it…' : 'Not right?'}</span>
          {choices.map((a) => (
            <button
              key={a.cls}
              type="button"
              className="rounded-full border border-border px-2 py-0.5 hover:bg-muted"
              onClick={() => onChange({ cls: a.cls, p: null })}
            >
              {labelOf(a.cls)} <span className="text-muted-foreground">{Math.round(a.p * 100)}%</span>
            </button>
          ))}
          <select
            aria-label="Choose another symbol"
            className="rounded-full border border-border bg-transparent px-2 py-0.5"
            value=""
            onChange={(e) => e.target.value && onChange({ cls: e.target.value, p: null })}
            onKeyDown={stop}
          >
            <option value="">Other…</option>
            {[...WAVE1_CLASSES, ...MECH_PICK].filter((c) => c !== ghost.cls).map((c) => (
              <option key={c} value={c}>{labelOf(c)}</option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}
