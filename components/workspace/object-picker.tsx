'use client'

// A component dropdown whose rows light up on the canvas: hover (or arrow-key
// onto) an entry and that object glows, so "which one is this?" is answered by
// looking, not by decoding a name. Native <select> can't do this — option
// hover isn't observable — hence the app's own Select.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useHoverHighlight } from '@/lib/store/hover-highlight'
import { cn } from '@/lib/utils'

export interface PickerOption {
  id: string
  label: string
}

export function ObjectPicker({
  value,
  options,
  onChange,
  placeholder = 'Select component…',
  ariaLabel,
  className,
}: {
  value: string
  options: PickerOption[]
  onChange: (id: string) => void
  placeholder?: string
  ariaLabel: string
  className?: string
}) {
  const glow = useHoverHighlight((s) => s.set)
  const known = options.some((o) => o.id === value)
  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      onOpenChange={(open) => {
        if (!open) glow(null)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className={cn('w-full min-w-0 px-2 text-ui-xs', className)}
        // Even closed, hovering the picker shows which object it currently holds.
        onPointerEnter={() => value && glow(value)}
        onPointerLeave={() => glow(null)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent onPointerLeave={() => glow(null)}>
        {!known && value && (
          <SelectItem value={value} disabled>
            (missing)
          </SelectItem>
        )}
        {options.map((o) => (
          // focus follows hover and arrow keys in Radix, so one handler covers both
          <SelectItem key={o.id} value={o.id} onFocus={() => glow(o.id)} onPointerMove={() => glow(o.id)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
