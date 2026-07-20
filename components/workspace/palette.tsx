'use client'

// Component palette — the sidebar's "Components" section. A component is
// just geometry + pre-attached behaviors — the user can always build the
// same thing by drawing and converting. Click a component, then click the
// canvas to place it (stays armed).
//
// This used to float as its own popup pinned to the dock (tracking the
// dock's side via useDockRect); it's a browser (domain tabs, scrollable
// grid), and browsers belong in the sidebar, not a flyout — see
// docs/ui-simplification-plan.md §3/§4. It now renders inline, filling
// whatever container the sidebar gives it.

import { useState } from 'react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useSpring } from '@/lib/motion'
import { COMPONENTS } from '@/lib/scene/factory'
import { useDocStore } from '@/lib/store/document'
import { usePrefs } from '@/lib/store/preferences'
import { cn } from '@/lib/utils'

const DOMAINS = [
  { id: 'mechanics', label: 'Mechanics' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'electronics', label: 'Electronics' },
  { id: 'digital', label: 'Digital' },
  { id: 'optics', label: 'Optics' },
  { id: 'waves', label: 'Waves' },
  { id: 'quantum', label: 'Quantum' },
  { id: 'economics', label: 'Economics' },
  { id: 'dsa', label: 'DSA' },
] as const

export function Palette() {
  const [domain, setDomain] = useState<(typeof DOMAINS)[number]['id']>('mechanics')
  const tool = useDocStore((s) => s.tool)
  const toolOption = useDocStore((s) => s.toolOption)
  const setTool = useDocStore((s) => s.setTool)

  return (
    <div className="flex h-full min-h-0 flex-col p-2.5" aria-label="Component palette">
      <div className="no-scrollbar mb-2 flex items-center gap-1 overflow-x-auto">
        {DOMAINS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
              domain === d.id
                ? 'bg-[var(--accent-blue)] text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            onClick={() => setDomain(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="no-scrollbar grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-1.5 overflow-y-auto">
        {COMPONENTS.filter((c) => c.domain === domain).map((c) => {
          const armed = tool === 'place' && toolOption === c.id
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={armed}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-xl border px-1.5 py-2 text-[11.5px] transition-colors',
                armed
                  ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)] text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
              onClick={() => setTool(armed ? 'select' : 'place', armed ? null : c.id)}
            >
              <span className="font-medium">{c.label}</span>
              {!c.live && <span className="text-[9px] uppercase tracking-wide opacity-60">symbol</span>}
            </button>
          )
        })}
      </div>
      {tool === 'place' && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Click the canvas to place · Esc to stop
        </p>
      )}
    </div>
  )
}

/**
 * The pre-sidebar floating popup, kept only for surfaces that don't have a
 * sidebar rail to dock into — the room-board presenter (app/board/page.tsx)
 * is a kiosk-style view with its own top-bar controls, not the notebook
 * shell, so it still opens the palette as a dock-anchored flyout.
 */
export function FloatingPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const motion = useSpring()
  const dock = usePrefs((s) => s.notebook.dock)
  const vertical = dock === 'left' || dock === 'right'
  // Grow out of the dock rather than up from the floor.
  const slideFrom =
    dock === 'left'
      ? { x: -16, y: 0 }
      : dock === 'right'
        ? { x: 16, y: 0 }
        : dock === 'top'
          ? { x: 0, y: -16 }
          : { x: 0, y: 16 }

  return (
    <AnimatePresence>
      {open && (
        <fm.div
          initial={{ ...slideFrom, opacity: 0, scale: 0.96 }}
          animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          exit={{ ...slideFrom, opacity: 0, scale: 0.96 }}
          transition={motion}
          className={cn(
            'glass-strong absolute z-40 max-h-[70vh] rounded-2xl',
            vertical
              ? 'top-1/2 w-[min(22rem,calc(100vw-6rem))] -translate-y-1/2 overflow-y-auto'
              : 'left-1/2 w-[min(26rem,calc(100vw-1rem))] -translate-x-1/2',
            dock === 'bottom' && 'bottom-20',
            dock === 'top' && 'top-20',
            dock === 'left' && 'left-20',
            dock === 'right' && 'right-20'
          )}
          aria-label="Component palette"
        >
          <div className="flex items-center justify-end px-2 pt-2">
            <button
              type="button"
              aria-label="Close palette"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Palette />
        </fm.div>
      )}
    </AnimatePresence>
  )
}
