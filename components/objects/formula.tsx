'use client'

import { useMemo, useState } from 'react'
import katex from 'katex'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'

export function FormulaObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const [editing, setEditing] = useState(false)
  const latex = getString(object, 'latex')

  const html = useMemo(() => {
    try {
      return katex.renderToString(latex || '\\text{empty}', { displayMode: true, throwOnError: false })
    } catch {
      return '<span>Invalid LaTeX</span>'
    }
  }, [latex])

  return (
    <div className="flex h-full w-full flex-col justify-center rounded-xl bg-card/60 p-3 hairline">
      {editing ? (
        <input
          autoFocus
          aria-label="LaTeX expression"
          className="w-full bg-transparent font-mono text-[13px] outline-none"
          value={latex}
          onChange={(e) => setStringParam(pageId, object.id, 'latex', e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') setEditing(false)
            e.stopPropagation()
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          aria-label="Edit formula"
          className="cursor-text text-left [&_.katex-display]:my-0"
          onDoubleClick={() => {
            pushHistory(pageId)
            setEditing(true)
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {selected && !editing && (
        <p className="mt-1 text-center text-[10.5px] text-muted-foreground">double-click to edit</p>
      )}
    </div>
  )
}
