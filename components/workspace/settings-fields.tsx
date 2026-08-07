'use client'

// Shared form primitives for the settings surfaces — the dialog's tabs and the
// pen popover in the dock both build from these, so a slider row looks the same
// wherever it appears.

import { cn } from '@/lib/utils'
import { InfoPopover } from './info-popover'
import { Switch } from '@/components/ui/switch'

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
          <p className="text-[0.8125rem] font-medium">{label}</p>
          {hint && <InfoPopover description={hint} />}
        </div>
        {value && <span className="font-mono text-[0.6875rem] text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  )
}

/** A labeled switch row — used by every settings surface and the pen popover's
 *  touch-assist section so a toggle looks the same wherever it appears. */
export function PrefRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string
  detail: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex items-center gap-1.5">
        <p className="text-[0.8125rem] font-medium">{label}</p>
        <InfoPopover description={detail} />
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
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
            'flex-1 rounded-md px-2 py-1 text-[0.75rem] font-medium transition-colors',
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
