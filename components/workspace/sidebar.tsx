'use client'

// The left dock's content — a permanently fixed rail (Notebook / Components /
// Tools / Library, with the institution mark on top) plus whichever ONE
// section is open. Replaces the old permanent 54/46 split between the
// notebook tree and the library: now each section gets the panel's full
// height when it's open.
//
// The rail itself never disappears — it's the fixed anchor point for the
// whole left edge, the way a dock or activity bar would be. Only the content
// PANE collapses when not in use (via the same sidebarOpen toggle the header
// and edge-handle already used) — collapsing used to hide the entire
// sidebar, rail included, which left branding and navigation with no fixed
// home. See docs/ui-simplification-plan.md §4.
//
// This is also where the physics/circuit Palette and the Calculator's
// trigger live now — they used to be floating popups pinned to the dock;
// browsers belong in a browsable drawer, not a flyout.
//
// "Left edge" is a desktop/tablet shape. On a phone the rail renders fixed
// along the bottom instead — a left column permanently eats into a phone's
// scarce width, and a phone has height to spare — with the open section's
// panel sliding up above it as a capped-height sheet, not sideways.

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useAuthStore } from '@/lib/auth/store'
import { useIsMobile, useIsNarrow } from '@/hooks/use-mobile'
import { useMobileNavBarStore } from '@/lib/store/mobile-nav-bar'
import { SIDEBAR_SECTIONS, type SidebarSectionId } from '@/lib/store/sidebar-sections'
import { NotebookTree } from './notebook-tree'
import { Palette } from './palette'
import { ToolsPanel } from './tools-panel'
import { LibraryPanel } from './library-panel'
import { cn } from '@/lib/utils'

const RAIL_TH = 52 // the rail's thickness — a column width on desktop, a bar height on phone

function RailButton({
  active,
  label,
  tooltipSide = 'right',
  onClick,
  children,
}: {
  active: boolean
  label: string
  tooltipSide?: 'top' | 'right'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors',
            active
              ? 'bg-[var(--accent-blue)] text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function Sidebar() {
  const motion = useSpring()
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const institution = useAuthStore((s) => s.institution)
  // A phone is a narrow TOUCH device — a tablet is touch but not narrow, a
  // narrowed desktop browser window is narrow but not touch, and neither of
  // those wants the bottom bar (matches the isMobile+isPhone combo
  // canvas-controls.tsx uses to reserve clearance for this same bar). Only
  // an actual phone gets it: a left column permanently eats into its scarce
  // width, and a phone has height to spare instead.
  const isMobile = useIsMobile()
  const isNarrow = useIsNarrow(767)
  const isPhone = isMobile && isNarrow

  // The dock (Toolbar/Transport, see canvas-controls.tsx) needs to always
  // clear this bar — rail alone when collapsed, rail+panel when it's open
  // and taller — so the actual measured height is published live rather
  // than assuming a fixed rail thickness.
  const barRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!isPhone) {
      useMobileNavBarStore.getState().setHeight(0)
      return
    }
    const el = barRef.current
    if (!el) return
    const publish = () => useMobileNavBarStore.getState().setHeight(el.getBoundingClientRect().height)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      useMobileNavBarStore.getState().setHeight(0)
    }
  }, [isPhone])

  // Which section shows when the pane is open — remembered even while
  // collapsed, so reopening lands back where you left it. Defaults to
  // Notebook (today's most-used section) rather than nothing, to keep the
  // day-one experience close to what it was before the rail existed.
  const [activeSection, setActiveSection] = useState<SidebarSectionId>(() => {
    if (typeof window === 'undefined') return 'notebook'
    const saved = localStorage.getItem('simblip-sidebar-section')
    return (SIDEBAR_SECTIONS.some((s) => s.id === saved) ? saved : 'notebook') as SidebarSectionId
  })

  const [panelW, setPanelW] = useState(() => {
    if (typeof window === 'undefined') return 288
    return Number(localStorage.getItem('simblip-sidebar-w')) || 288
  })

  const selectSection = (id: SidebarSectionId) => {
    if (sidebarOpen && activeSection === id) {
      togglePanel('sidebar') // same section tapped again — collapse the pane
      return
    }
    setActiveSection(id)
    try {
      localStorage.setItem('simblip-sidebar-section', id)
    } catch {}
    if (!sidebarOpen) togglePanel('sidebar')
  }

  const railNav = (
    <nav
      className={cn(
        'flex shrink-0 items-center gap-2',
        isPhone ? 'w-full flex-row justify-center px-3 py-2' : 'w-[52px] flex-col py-3'
      )}
    >
      {institution?.logo_url ? (
        <Image
          src={String(institution.logo_url)}
          alt={institution.name}
          width={28}
          height={28}
          unoptimized
          className={cn('h-7 w-7 shrink-0 rounded-lg object-contain', !isPhone && 'mb-1')}
        />
      ) : (
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-blue)] text-[13px] font-extrabold text-white',
            !isPhone && 'mb-1'
          )}
        >
          S
        </span>
      )}
      <div className={cn('shrink-0 bg-border', isPhone ? 'h-6 w-px' : 'h-px w-6')} />
      {SIDEBAR_SECTIONS.map((s) => (
        <RailButton
          key={s.id}
          label={s.label}
          tooltipSide={isPhone ? 'top' : 'right'}
          active={sidebarOpen && activeSection === s.id}
          onClick={() => selectSection(s.id)}
        >
          <s.icon className="h-[18px] w-[18px]" />
        </RailButton>
      ))}
    </nav>
  )

  const panelSections = (
    <>
      {activeSection === 'notebook' && <NotebookTree />}
      {activeSection === 'components' && <Palette />}
      {activeSection === 'tools' && <ToolsPanel />}
      {activeSection === 'library' && (
        <LibraryPanel inline open onClose={() => togglePanel('sidebar')} pageId={activePageId} />
      )}
    </>
  )

  // A left column permanently eats into a phone's scarce width; a phone has
  // height to spare instead, so the rail renders as a fixed bottom bar there
  // (same isPhone signal the Inspector uses for its own bottom sheet, see
  // mobile-shell.tsx) — a tablet keeps the desktop-shaped left rail below.
  if (isPhone) {
    return (
      <fm.aside
        ref={barRef}
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={motion}
        className="glass-strong fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-border/40 pb-[env(safe-area-inset-bottom)]"
        aria-label="Sidebar"
      >
        {sidebarOpen && (
          <div className="flex max-h-[38dvh] min-h-0 flex-col overflow-hidden border-b border-border/50">
            <div className="min-h-0 flex-1 overflow-y-auto">{panelSections}</div>
          </div>
        )}
        {railNav}
      </fm.aside>
    )
  }

  return (
    <fm.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={motion}
      className="glass relative z-30 m-3 flex min-h-0 flex-row rounded-2xl"
      style={{ width: sidebarOpen ? RAIL_TH + panelW : RAIL_TH }}
      aria-label="Sidebar"
    >
      {railNav}

      {sidebarOpen && (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-border/50">
          <div
            role="separator"
            aria-label="Resize sidebar"
            className="absolute -right-2 top-0 z-10 h-full w-4 touch-none cursor-col-resize"
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              const startX = e.clientX
              const startW = panelW
              const move = (ev: PointerEvent) =>
                setPanelW(Math.min(480, Math.max(200, startW + (ev.clientX - startX))))
              const up = (ev: PointerEvent) => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                try {
                  localStorage.setItem(
                    'simblip-sidebar-w',
                    String(Math.min(480, Math.max(200, startW + (ev.clientX - startX))))
                  )
                } catch {}
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />

          {panelSections}
        </div>
      )}
    </fm.aside>
  )
}
