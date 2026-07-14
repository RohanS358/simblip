'use client'

// Shared form primitives for the settings surfaces — the dialog's tabs and the
// pen popover in the dock both build from these, so a slider row looks the same
// wherever it appears.

import { cn } from '@/lib/utils'
import { InfoPopover } from './info-popover'

export function Field({
  label,
  hint,
  value,
  children,
}: {
  label: string
  hint?: string
  value?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="text-[13px] font-medium">{label}</p>
          {hint && <InfoPopover description={hint} />}
        </div>
        {value && <span className="font-mono text-[11px] text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  )
}

/** Segmented option row — the visual equivalent of a radio group. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-accent/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
            value === o.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
