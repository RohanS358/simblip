'use client'

import type { ObjectRendererProps } from './types'
import { RichTextArea } from './text'
import { cn } from '@/lib/utils'

const FILLS: Record<string, string> = {
  amber: 'bg-[color-mix(in_oklch,var(--accent-amber)_18%,var(--card))]',
  mint: 'bg-[color-mix(in_oklch,var(--accent-mint)_18%,var(--card))]',
  blue: 'bg-[color-mix(in_oklch,var(--accent-blue)_14%,var(--card))]',
  violet: 'bg-[color-mix(in_oklch,var(--accent-violet)_14%,var(--card))]',
  rose: 'bg-[color-mix(in_oklch,var(--accent-rose)_14%,var(--card))]',
}

export function NoteObject(props: ObjectRendererProps) {
  const color = (props.object.metadata.color as string) ?? 'amber'
  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden rounded-xl p-3 hairline shadow-sm',
        FILLS[color] ?? FILLS.amber
      )}
    >
      <RichTextArea
        {...props}
        placeholder="Write a note…"
        padY={24 /* p-3 top + bottom, so the box grows before clipping */}
        className="text-[13.5px]"
      />
    </div>
  )
}
