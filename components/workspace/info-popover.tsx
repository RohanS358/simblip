'use client'

import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function InfoPopover({
  description,
  side = 'top',
}: {
  description: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side={side} className="w-56 text-ui-xs leading-relaxed">
        {description}
      </PopoverContent>
    </Popover>
  )
}