'use client'

// Component palette. A component is just geometry + pre-attached behaviors —
// the user can always build the same thing by drawing and converting.
// Click a component, then click the canvas to place it (stays armed).

import { useState } from 'react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { X } from 'lucide-react'
import { COMPONENTS } from '@/lib/scene/factory'
import { useDocStore } from '@/lib/store/document'
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
] as const

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const motion = useSpring()
  const [domain, setDomain] = useState<(typeof DOMAINS)[number]['id']>('mechanics')
  const tool = useDocStore((s) => s.tool)
  const toolOption = useDocStore((s) => s.toolOption)
  const setTool = useDocStore((s) => s.setTool)

  return (
    <AnimatePresence>
      {open && (
        <fm.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={motion}
          className="glass-strong absolute bottom-20 left-1/2 z-40 w-[min(26rem,calc(100vw-1rem))] -translate-x-1/2 rounded-2xl p-3"
          aria-label="Component palette"
        >
          <div className="mb-2 flex items-center gap-1">
            <div className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
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
            <button
              type="button"
              aria-label="Close palette"
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="no-scrollbar grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
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
        </fm.div>
      )}
    </AnimatePresence>
  )
}
