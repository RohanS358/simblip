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
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useAuthStore } from '@/lib/auth/store'
import { useIsMobile, useIsNarrow } from '@/hooks/use-mobile'
import { useMobileNavBarStore } from '@/lib/store/mobile-nav-bar'
import {
  SIDEBAR_SECTIONS,
  useSidebarSection,
  type SidebarSectionId,
} from '@/lib/store/sidebar-sections'
import { NotebookTree } from './notebook-tree'
import { Palette } from './palette'
import { ToolsPanel } from './tools-panel'
import { LibraryPanel } from './library-panel'
import { InspectorPane } from './inspector'
import { cn } from '@/lib/utils'

// Rail thickness comes from railNav's own classes (w-[52px] column on
// desktop, a bar on phone) — no computed widths anymore; the pane's fold
// is a Framer width animation instead.

export function RailButton({
  active = false,
  label,
  tooltipSide = 'right',
  onClick,
  children,
}: {
  active?: boolean
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

export function Sidebar({
  hideNotebook = false,
  bottomRailContent,
}: {
  hideNotebook?: boolean
  bottomRailContent?: React.ReactNode
}) {
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
  // collapsed, so reopening lands back where you left it. Shared store (not
  // local state) so actions elsewhere — the dock's Properties action, the
  // context menu — can land the user on a specific section.
  const activeSection = useSidebarSection((s) => s.section)
  const setActiveSection = useSidebarSection((s) => s.setSection)

  useEffect(() => {
    if (hideNotebook && activeSection === 'notebook') {
      setActiveSection('components')
    }
  }, [hideNotebook, activeSection, setActiveSection])

  const sections = hideNotebook
    ? SIDEBAR_SECTIONS.filter((s) => s.id !== 'notebook')
    : SIDEBAR_SECTIONS

  // What Properties operates on: boards act on themselves, docs act on the
  // focused sheet, PDF readers on the focused ink/notes canvas — the same
  // derivation the toolbar/transport use (see shell.tsx).
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const pdfToolsActive = useWorkspaceStore((s) => s.pdfToolsActive)
  const activeKind = useWorkspaceStore(
    (s) => findPageMeta(s.notebooks, s.activePageId)?.kind ?? 'board'
  )
  const contentPageId =
    activeKind === 'doc' || (activeKind === 'pdf' && pdfToolsActive)
      ? (activeSheetId ?? activePageId)
      : activePageId

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
    if (!sidebarOpen) togglePanel('sidebar')
  }

  const railNav = (
    <nav
      className={cn(
        'flex shrink-0 items-center gap-2',
        isPhone ? 'w-full flex-row justify-center px-3 py-2' : 'h-full flex-col py-3'
      )}
    >
      {sections.map((s) => (
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
      {bottomRailContent && (
        <div className={cn('flex items-center justify-center', !isPhone && 'mt-auto')}>
          {bottomRailContent}
        </div>
      )}
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
      {activeSection === 'properties' &&
        (contentPageId ? (
          <InspectorPane pageId={contentPageId} />
        ) : (
          <p className="py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
            Open a page to inspect its objects and variables.
          </p>
        ))}
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
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">{panelSections}</div>
          </div>
        )}
        {railNav}
      </fm.aside>
    )
  }

  return (
    // Not a floating card: the rail is flush window chrome (like an activity
    // bar), and the content pane folds out of it with an interruptible
    // spring. Only the pane carries the soft glass edge.
    <fm.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={motion}
      className="relative z-30 flex min-h-0 flex-row"
      aria-label="Sidebar"
    >
      <div className="flex min-h-0 flex-col border-r bg-sidebar/85 backdrop-blur-xl">
        {railNav}
      </div>

      {/* Width animates; the content keeps its TRUE width inside the
          overflow-hidden fold so text never reflows mid-motion. */}
      <fm.div
        initial={false}
        animate={{ width: sidebarOpen ? panelW : 0, opacity: sidebarOpen ? 1 : 0 }}
        transition={motion}
        className="relative z-30 my-2 min-h-0 overflow-hidden"
      >
        <div
          style={{ width: panelW }}
          className="relative flex h-full min-h-0 flex-col rounded-r-2xl "
        >
          <div
            role="separator"
            aria-label="Resize sidebar"
            className="absolute -right-3 top-0 z-10 h-full w-4 touch-none cursor-col-resize border-l border-border/50 transition-all duration-150 hover:border-l-2 hover:border-sky-400 hover:shadow-[2px_0_2px_2px_rgba(56,189,248,0.5)]"
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
      </fm.div>
    </fm.aside>
  )
}
