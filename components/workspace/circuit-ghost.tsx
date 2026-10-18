'use client'

// The whole-circuit preview ("Sketch → circuit"): every part the reader found,
// drawn translucent over the ink with its number and confidence, the wires it
// connected highlighted, loose wire ends marked red — and a panel to confirm or
// correct before anything is replaced.
//
// Two pieces, because they live in different coordinate spaces:
//   <CircuitGhostOverlay>  page coordinates (moves and zooms with the drawing)
//   <CircuitGhostPanel>    screen space (always readable)

import { useEffect, useMemo } from 'react'
import { Check, RotateCw, X } from 'lucide-react'
import { componentById } from '@/lib/scene/factory'
import { WAVE1_CLASSES } from '@/lib/sketch/classes'
import { mainParamOf, parseQuantity } from '@/lib/sketch/compile'
import type { CircuitGhost, PartEdit } from '@/lib/sketch/circuit-ghost'
import { toCheck } from '@/lib/sketch/circuit-ghost'
import { stepLine, type StepFailure } from '@/lib/sketch/pipeline'
import { confidenceOf, ghostSize } from '@/lib/sketch/ghost'
import { SymbolIcon } from '@/components/objects/geometry'

const DOT = {
  high: 'var(--accent-mint)',
  medium: 'var(--accent-amber)',
  low: 'var(--accent-rose)',
  chosen: 'var(--accent-blue)',
} as const

const labelOf = (cls: string) => componentById(cls)?.label ?? cls

/** The confidence colour of a part: its own, or "chosen" once the person fixed its class. */
function colourOf(g: CircuitGhost, id: string, conf: number, cls: string) {
  const was = g.original[id]
  return DOT[confidenceOf(was && was.cls !== cls ? null : conf)]
}

export function CircuitGhostOverlay({ ghost, zoom, hoverId }: { ghost: CircuitGhost; zoom: number; hoverId: string | null }) {
  const r = ghost.result
  return (
    <>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
        {(r.wires ?? []).map((w) => (
          <polyline
            key={w.id}
            points={w.pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
            fill="none"
            stroke="var(--accent-blue)"
            strokeOpacity={0.45}
            strokeWidth={4 / zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {(r.looseEnds ?? []).map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={7 / zoom} fill="none" stroke="var(--accent-rose)" strokeWidth={2 / zoom} />
        ))}
      </svg>
      {r.parts.map((p, i) => (
        <PartGhost key={p.id} ghost={ghost} index={i} zoom={zoom} emphasised={hoverId === p.id} />
      ))}
    </>
  )
}

function PartGhost({ ghost, index, zoom, emphasised }: { ghost: CircuitGhost; index: number; zoom: number; emphasised: boolean }) {
  const p = ghost.result.parts[index]
  const part = useMemo(() => {
    const def = componentById(p.cls)
    if (!def) return null
    const o = def.create({ x: 0, y: 0 })
    o.size = ghostSize(p.box, o.geometry.kind === 'symbol')
    return o
  }, [p.cls, p.box])
  if (!part) return null
  const cx = (p.box.x0 + p.box.x1) / 2
  const cy = (p.box.y0 + p.box.y1) / 2
  const colour = colourOf(ghost, p.id, p.conf, p.cls)
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: cx - part.size.w / 2,
          top: cy - part.size.h / 2,
          width: part.size.w,
          height: part.size.h,
          opacity: emphasised ? 0.85 : 0.55,
          transform: `rotate(${p.pose}deg)`,
          color: colour,
        }}
      >
        <SymbolIcon obj={part} pins={false} />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-md border border-dashed"
        style={{
          left: p.box.x0 - 5,
          top: p.box.y0 - 5,
          width: p.box.x1 - p.box.x0 + 10,
          height: p.box.y1 - p.box.y0 + 10,
          borderColor: colour,
          borderWidth: emphasised ? 2 : 1,
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
        style={{ left: p.box.x0 - 5, top: p.box.y0 - 5 - 16 / zoom, background: colour, transform: `scale(${1 / zoom})`, transformOrigin: 'bottom left' }}
      >
        {index + 1}
      </span>
    </>
  )
}

const WHY: Record<string, string> = {
  'low-confidence': 'not sure what this part is',
  'ambiguous-junction': 'check which pin each wire goes to',
  'dangling-wire': 'a wire end is not connected to anything (circled red)',
  'unreadable-value': 'its value could not be read',
}

export function CircuitGhostPanel({
  ghost,
  error,
  onEdit,
  onKeepLayout,
  onHover,
  onConfirm,
  onCancel,
}: {
  ghost: CircuitGhost
  error: StepFailure | null
  onEdit: (id: string, edit: PartEdit) => void
  onKeepLayout: (keep: boolean) => void
  onHover: (id: string | null) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const r = ghost.result
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const nameOf = (id: string) => `Part ${r.parts.findIndex((p) => p.id === id) + 1}`
  const seen = new Set<string>()
  const lines = r.ir.doubts
    .map((d) => (d.ref.startsWith('wire:') ? `Wire: ${WHY[d.why]}` : d.ref.includes('.') ? `${nameOf(d.ref.split('.')[0])}: ${WHY[d.why]}` : `${nameOf(d.ref)}: ${WHY[d.why]}`))
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))

  return (
    <div
      role="dialog"
      aria-label="Sketch to circuit"
      className="pointer-events-auto absolute left-1/2 top-3 z-50 flex max-h-[72vh] w-[min(94vw,480px)] -translate-x-1/2 flex-col gap-2 overflow-auto rounded-lg border border-border bg-card p-3 text-ui-sm shadow-xl"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">Sketch → circuit</span>
        <span className="text-muted-foreground">
          {r.parts.length} part{r.parts.length === 1 ? '' : 's'} · {r.ir.edges.length} connection{r.ir.edges.length === 1 ? '' : 's'} ·{' '}
          {toCheck(ghost) ? `${toCheck(ghost)} to check` : 'nothing to check'}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {r.parts.map((p, i) => {
          const key = mainParamOf(p.cls)
          const value = key ? p.values?.[key] ?? '' : ''
          const bad = !!value && !parseQuantity(value)
          return (
            <li
              key={p.id}
              className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted/60"
              onPointerEnter={() => onHover(p.id)}
              onPointerLeave={() => onHover(null)}
            >
              <span
                className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
                style={{ background: colourOf(ghost, p.id, p.conf, p.cls) }}
                title={ghost.original[p.id]?.cls !== p.cls ? 'You chose this' : `${Math.round(p.conf * 100)}% sure`}
              >
                {i + 1}
              </span>
              <select
                aria-label={`Part ${i + 1} symbol`}
                className="min-w-0 flex-1 rounded border border-border bg-transparent px-1.5 py-0.5"
                value={p.cls}
                onChange={(e) => onEdit(p.id, { cls: e.target.value })}
              >
                {WAVE1_CLASSES.map((c) => (
                  <option key={c} value={c}>{labelOf(c)}</option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Rotate part ${i + 1}`}
                title="Rotate 90°"
                className="rounded p-1 hover:bg-muted"
                onClick={() => onEdit(p.id, { pose: (((p.pose + 90) % 360) as typeof p.pose) })}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              {key ? (
                <input
                  aria-label={`Part ${i + 1} ${key}`}
                  aria-invalid={bad}
                  placeholder={`${key}: 10k`}
                  className={`w-20 rounded border bg-transparent px-1.5 py-0.5 font-mono ${bad ? 'border-[var(--accent-rose)]' : 'border-border'}`}
                  value={value}
                  onChange={(e) => onEdit(p.id, { value: e.target.value })}
                />
              ) : (
                <span className="w-20" />
              )}
            </li>
          )
        })}
      </ul>

      {lines.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}

      <label className="flex items-center gap-2 text-muted-foreground">
        <input type="checkbox" checked={ghost.keepLayout} onChange={(e) => onKeepLayout(e.target.checked)} />
        Keep my layout (otherwise the circuit is drawn tidily)
      </label>

      {error && (
        <div role="alert" className="rounded border border-[var(--accent-rose)] p-2">
          <p className="text-ui-xs uppercase tracking-wide text-muted-foreground">{stepLine(error.step)}</p>
          <p className="font-medium text-[var(--accent-rose)]">{error.title}</p>
          <p className="mt-0.5 break-words text-muted-foreground">{error.detail}</p>
          <p className="mt-1 text-muted-foreground">
            {error.built ? 'The circuit is on the page.' : 'Your sketch is untouched.'} The recognition itself was fine — fix a part or value above and try again.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="flex items-center gap-1 rounded border border-border px-2.5 py-1 hover:bg-muted" onClick={onCancel}>
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        <button
          type="button"
          className="flex items-center gap-1 whitespace-nowrap rounded bg-[var(--accent-blue)] px-2.5 py-1 font-medium text-white hover:opacity-90"
          onClick={onConfirm}
        >
          <Check className="h-3.5 w-3.5" /> Make it live
        </button>
      </div>
    </div>
  )
}
