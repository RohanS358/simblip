'use client'

// Undo / redo in the header. The keyboard shortcuts already existed; this makes
// them discoverable — and reachable on a tablet, where there's no Ctrl+Z.

import { Undo2, Redo2 } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function UndoRedo({ pageId }: { pageId: string }) {
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)
  // Subscribing to the page's content is what keeps the buttons' enabled state
  // honest — the history stacks themselves live outside the store.
  const canUndoRedo = useDocStore((s) => Boolean(s.pages[pageId]))

  const btn = (
    label: string,
    keys: string,
    Icon: typeof Undo2,
    action: () => void
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={!canUndoRedo}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent'
          )}
          onClick={action}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-1.5 text-ui-xs">
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <div className="flex items-center">
      {btn('Undo', 'Ctrl Z', Undo2, () => undo(pageId))}
      {btn('Redo', 'Ctrl ⇧ Z', Redo2, () => redo(pageId))}
    </div>
  )
}
