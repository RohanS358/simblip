'use client'

import { useRef } from 'react'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'
import { cn } from '@/lib/utils'

const FILLS: Record<string, string> = {
  amber: 'bg-[color-mix(in_oklch,var(--accent-amber)_18%,var(--card))]',
  mint: 'bg-[color-mix(in_oklch,var(--accent-mint)_18%,var(--card))]',
  blue: 'bg-[color-mix(in_oklch,var(--accent-blue)_14%,var(--card))]',
  violet: 'bg-[color-mix(in_oklch,var(--accent-violet)_14%,var(--card))]',
  rose: 'bg-[color-mix(in_oklch,var(--accent-rose)_14%,var(--card))]',
}

export function NoteObject({ pageId, object }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const focusedRef = useRef(false)
  const color = (object.metadata.color as string) ?? 'amber'

  return (
    <div className={cn('h-full w-full rounded-xl p-3 hairline shadow-sm', FILLS[color] ?? FILLS.amber)}>
      <textarea
        aria-label="Sticky note"
        className="h-full w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
        placeholder="Write a note…"
        value={getString(object, 'text')}
        onFocus={() => {
          if (!focusedRef.current) {
            focusedRef.current = true
            pushHistory(pageId)
          }
        }}
        onBlur={() => (focusedRef.current = false)}
        onChange={(e) => setStringParam(pageId, object.id, 'text', e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}
