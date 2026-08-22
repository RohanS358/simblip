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
          <p className="text-ui-md font-medium">{label}</p>
          {hint && <InfoPopover description={hint} />}
        </div>
        {value && <span className="font-mono text-ui-xs text-muted-foreground">{value}</span>}
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
      <div className="flex flex-col min-w-0 pr-2">
        <div className="flex items-center gap-1.5">
          <p className="text-ui-md font-medium">{label}</p>
          {detail && <InfoPopover description={detail} />}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        className="data-[state=checked]:bg-[#7f6df2] dark:data-[state=checked]:bg-[#7f6df2]"
      />
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
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-1 rounded-lg bg-accent/40 p-1 border border-border/30 max-w-full overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={cn(
            'flex-1 shrink-0 min-w-fit whitespace-nowrap rounded-md px-3 py-1 text-ui-sm font-medium transition-[background-color,color] duration-150 ease-out',
            value === o.id
              ? 'bg-background text-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
          )}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Obsidian-style Card container for setting groups */
export function SettingCard({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-border/50 bg-muted/20 dark:bg-muted/10 p-4 sm:p-5 space-y-4 shadow-2xs', className)}>
      {title && (
        <h3 className="text-ui-xs font-bold text-muted-foreground/80 tracking-wider uppercase">
          {title}
        </h3>
      )}
      <div className="divide-y divide-border/30 space-y-3.5 pt-0.5">
        {children}
      </div>
    </div>
  )
}

/** Obsidian Setting Row: Title on left, hint/detail below, control on right */
export function ObsidianPrefRow({
  label,
  detail,
  action,
  children,
  className,
}: {
  label: string
  detail?: string
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6 pt-3.5 first:pt-0', className)}>
      <div className="flex flex-col flex-1 min-w-0 pr-2">
        <p className="text-ui-md font-medium text-foreground">{label}</p>
        {detail && <p className="text-ui-sm text-muted-foreground leading-relaxed mt-0.5">{detail}</p>}
      </div>
      <div className="shrink-0 flex items-center justify-end gap-2.5 pt-0.5 sm:pt-0 self-start sm:self-center max-w-full">
        {action ?? children}
      </div>
    </div>
  )
}


