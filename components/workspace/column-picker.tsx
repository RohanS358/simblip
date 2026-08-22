'use client'

// "Which of these components are my columns?" — shared by the Truth Table
// object's inline quick-pick and the Inspector's column editor, which used to
// be two hand-maintained copies of the same toggle grid that drifted apart.
//
// Two densities: `chip` (compact, wraps — for the small on-canvas card) and
// `row` (full-width list with the symbol name — for the Inspector's panel).

import type { SceneObject } from '@/lib/scene/types'
import { splitIds } from '@/lib/scene/bindings'

export interface ColumnPickerProps {
  /** Candidates to offer, in placement order. */
  items: SceneObject[]
  /** Currently chosen ids, ";"-separated (the raw param value). */
  value: string
  /** Called with the next ";"-separated value. */
  onChange: (next: string) => void
  /** Accent for the "on" state — chart token, distinct per column group. */
  color: string
  /** Shown when there are no candidates at all. */
  empty: string
  variant?: 'chip' | 'row'
}

export function ColumnPicker({
  items,
  value,
  onChange,
  color,
  empty,
  variant = 'row',
}: ColumnPickerProps) {
  const chosen = splitIds(value)
  const toggle = (id: string) =>
    onChange(
      (chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]).join('; ')
    )

  if (items.length === 0) {
    return (
      <p
        className={
          variant === 'chip'
            ? 'text-ui-2xs text-muted-foreground'
            : 'text-ui-xs text-muted-foreground'
        }
      >
        {empty}
      </p>
    )
  }

  if (variant === 'chip') {
    return (
      <div className="flex flex-wrap gap-1">
        {items.map((o) => {
          const on = chosen.includes(o.id)
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              className="rounded-md border px-1.5 py-0.5 font-mono text-ui-2xs transition-colors"
              style={{
                borderColor: on ? color : 'var(--border)',
                color: on ? color : 'var(--muted-foreground)',
                background: on ? `color-mix(in oklch, ${color} 12%, transparent)` : 'transparent',
              }}
              // The card sits on the canvas — a pointerdown here would start
              // dragging the object instead of hitting the button.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => toggle(o.id)}
            >
              {o.name}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {items.map((o) => {
        const on = chosen.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            role="switch"
            aria-checked={on}
            className="flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-ui-sm transition-colors"
            style={{
              borderColor: on ? color : 'var(--border)',
              color: on ? 'var(--foreground)' : 'var(--muted-foreground)',
              background: on ? `color-mix(in oklch, ${color} 10%, transparent)` : 'transparent',
            }}
            onClick={() => toggle(o.id)}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: on ? color : 'var(--border)' }}
            />
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className="shrink-0 font-mono text-ui-2xs opacity-60">
              {o.geometry.symbol}
            </span>
          </button>
        )
      })}
    </div>
  )
}
