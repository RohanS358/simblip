'use client'

import { useRef } from 'react'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'

export function TextObject({ pageId, object }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const focusedRef = useRef(false)

  return (
    <textarea
      aria-label="Text block"
      className="h-full w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
      placeholder="Type something…"
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
  )
}
