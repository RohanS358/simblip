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

import { useMemo, useState } from 'react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { useSpring } from '@/lib/motion'
import { COMPONENTS } from '@/lib/scene/factory'
import { useDocStore } from '@/lib/store/document'
import { usePrefs } from '@/lib/store/preferences'
import { useIsMobile } from '@/hooks/use-mobile'
import { Input } from '@/components/ui/input'
import { ComponentIcon } from './component-icons'
import { cn } from '@/lib/utils'

// Stable empty reference — see components/objects/table.tsx.
const EMPTY_PACKAGES: Record<string, unknown> = Object.freeze({})

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

type DomainId = (typeof DOMAINS)[number]['id']

const DOMAIN_LABEL: Record<DomainId, string> = Object.fromEntries(
  DOMAINS.map((d) => [d.id, d.label])
) as Record<DomainId, string>

/** Search + category filter, same pattern as the Institution Library — a
 *  query box and a single-select category row (with an "All" pill), both
 *  narrowing the same list together. See docs/ui-simplification-plan.md
 *  (Components section should search/section like the Library). */
export function Palette() {
  const packages = usePrefs((s) => s.packages ?? EMPTY_PACKAGES)
  const [domain, setDomain] = useState<DomainId | null>(null)
  const [query, setQuery] = useState('')
  const tool = useDocStore((s) => s.tool)
  const toolOption = useDocStore((s) => s.toolOption)
  const setTool = useDocStore((s) => s.setTool)

  const activeDomains = useMemo(() => {
    return DOMAINS.filter((d) => packages[d.id] !== false)
  }, [packages])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return COMPONENTS.filter((c) => packages[c.domain] !== false)
      .filter((c) => !domain || c.domain === domain)
      .filter((c) => !q || c.label.toLowerCase().includes(q))
  }, [domain, query, packages])

  const currentDomainValid = domain === null || packages[domain] !== false

  return (
    <div className="flex h-full min-h-0 flex-col py-1" aria-label="Component palette">
      {/* Sticky Header: Search Bar & Domain Filters */}
      <div className="sticky top-0 z-20 shrink-0 bg-card/80 backdrop-blur-xl supports-[backdrop-filter]:bg-card/60 px-2.5 pb-2 pt-1 border-b border-border/50 mb-2 space-y-2">
         <span className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Components
          </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components…"
            className="h-8 pl-8 text-[0.78125rem]"
          />
        </div>

        <div className="no-scrollbar -mx-2.5 flex items-center gap-1 overflow-x-auto px-2.5">
          <button
            type="button"
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium transition-colors',
              (domain === null || !currentDomainValid)
                ? 'bg-foreground text-background font-semibold'
                : 'bg-accent text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setDomain(null)}
          >
            All
          </button>
          {activeDomains.map((d) => (
            <button
              key={d.id}
              type="button"
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium transition-colors',
                domain === d.id
                  ? 'bg-foreground text-background font-semibold'
                  : 'bg-accent text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setDomain(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-1.5 overflow-y-auto px-2.5">
        {filtered.map((c) => {
          const armed = tool === 'place' && toolOption === c.id
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={armed}
              // Always a lightly-bordered card (like a Library asset tile) —
              // the icon is what makes a part recognizable at a glance; the
              // accent border/tint on top of that just marks "armed."
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-[0.71875rem] transition-colors',
                armed
                  ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)] text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground'
              )}
              onClick={() => setTool(armed ? 'select' : 'place', armed ? null : c.id)}
            >
              <span
                className={cn(
                  'flex h-9 w-full items-center justify-center px-1',
                  armed ? 'text-[var(--accent-blue)]' : 'text-foreground/80'
                )}
              >
                <ComponentIcon def={c} />
              </span>
              <span className="font-medium leading-tight">{c.label}</span>
              {/* The domain tag only earns its place once "All" mixes
                  domains together — otherwise the selected pill already
                  says which one this is. "symbol" always matters, though. */}
              {(domain === null || !c.live) && (
                <span className="text-[0.5625rem] uppercase tracking-wide opacity-60">
                  {[domain === null ? DOMAIN_LABEL[c.domain as DomainId] : null, !c.live ? 'symbol' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="col-span-3 py-6 text-center text-[0.75rem] text-muted-foreground">
            No components match “{query}”.
          </p>
        )}
      </div>
      {tool === 'place' && (
        <p className="mt-2 text-center text-[0.6875rem] text-muted-foreground">
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
  const dockPref = usePrefs((s) => s.notebook.dock)
  // Same mobile override as the dock itself (canvas-controls.tsx/toolbar.tsx)
  // — this flyout has to slide out of whichever side the dock is actually
  // rendering on, not the raw desktop preference.
  const isMobile = useIsMobile()
  const dock = isMobile && (dockPref === 'left' || dockPref === 'right') ? 'bottom' : dockPref
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
