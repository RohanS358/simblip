'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'
import { executeSimScript } from '@/lib/scene/simscript'

export function CodeObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const [editing, setEditing] = useState(false)
  const source = getString(object, 'source', '// Write SimScript here...\n')
  const [error, setError] = useState<string | null>(null)

  const runCode = () => {
    pushHistory(pageId)
    setError(null)
    // Pass the IDE's own canvas position+size so the engine can offset
    // spawned objects to appear to the right of the code block.
    const ideOrigin = {
      x: object.position.x + object.size.w + 40, // 40px gap to the right
      y: object.position.y,
    }
    try {
      executeSimScript(pageId, source, ideOrigin)
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-[var(--background)] shadow-sm"
      onPointerDown={(e) => {
        if (editing) e.stopPropagation()
      }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-1.5">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">SimScript IDE</span>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded bg-[var(--accent-blue)] px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-600"
          onClick={runCode}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Play className="h-3 w-3 fill-current" />
          Run
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <textarea
          className="h-full w-full resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          value={source}
          placeholder="// Write your code here"
          spellCheck={false}
          onPointerDown={(e) => e.stopPropagation()} // Let the user click to place cursor
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            if (!editing) pushHistory(pageId)
            setStringParam(pageId, object.id, 'source', e.target.value)
            setEditing(true)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.currentTarget.blur()
              setEditing(false)
            }
          }}
        />
      </div>

      {error && (
        <div className="shrink-0 border-t border-red-500/20 bg-red-500/10 px-3 py-2 text-[11.5px] font-mono text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}
