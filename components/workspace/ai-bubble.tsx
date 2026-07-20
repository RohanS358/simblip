'use client'

// The AI assistant's trigger — a small corner bubble, not a dock button.
// AI chat is a distinct product surface (conversational, violet-tinted),
// not a drawing mode or a browsable list, so it gets the same
// always-reachable, never-in-your-way treatment chat assistants get
// everywhere else (Intercom/Linear pattern). Sits in whichever corner the
// dock isn't occupying. See docs/ui-simplification-plan.md §3.

import { Sparkles } from 'lucide-react'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { usePrefs } from '@/lib/store/preferences'
import { cn } from '@/lib/utils'

export function AiBubble() {
  const aiOpen = useWorkspaceStore((s) => s.aiOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const dock = usePrefs((s) => s.notebook.dock)

  // The AI panel itself occupies this corner (a tall right-hand column)
  // while open — the bubble would just sit under it.
  if (aiOpen) return null

  return (
    <button
      type="button"
      aria-label="Ask AI"
      onClick={() => togglePanel('ai')}
      className={cn(
        'glass-strong absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 flex h-11 w-11 items-center justify-center rounded-full text-[var(--accent-violet)] shadow-lg transition-transform hover:scale-105 active:scale-95',
        // Dodge the dock: if it's docked right, the bubble moves to the
        // opposite corner instead of landing underneath it.
        dock === 'right' ? 'left-5' : 'right-5'
      )}
    >
      <Sparkles className="h-5 w-5" />
    </button>
  )
}
