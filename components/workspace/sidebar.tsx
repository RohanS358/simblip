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

import { useState } from 'react'
import Image from 'next/image'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useAuthStore } from '@/lib/auth/store'
import { SIDEBAR_SECTIONS, type SidebarSectionId } from '@/lib/store/sidebar-sections'
import { NotebookTree } from './notebook-tree'
import { Palette } from './palette'
import { ToolsPanel } from './tools-panel'
import { LibraryPanel } from './library-panel'
import { cn } from '@/lib/utils'

const RAIL_W = 52

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
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
      <TooltipContent side="right" className="text-xs">
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

  return (
    <fm.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={motion}
      className="glass relative z-30 m-3 flex min-h-0 flex-row rounded-2xl"
      style={{ width: sidebarOpen ? RAIL_W + panelW : RAIL_W }}
      aria-label="Sidebar"
    >
      <nav className="flex w-[52px] shrink-0 flex-col items-center gap-2 py-3">
        {institution?.logo_url ? (
          <Image
            src={String(institution.logo_url)}
            alt={institution.name}
            width={28}
            height={28}
            unoptimized
            className="mb-1 h-7 w-7 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <span className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-blue)] text-[13px] font-extrabold text-white">
            S
          </span>
        )}
        <div className="h-px w-6 shrink-0 bg-border" />
        {SIDEBAR_SECTIONS.map((s) => (
          <RailButton
            key={s.id}
            label={s.label}
            active={sidebarOpen && activeSection === s.id}
            onClick={() => selectSection(s.id)}
          >
            <s.icon className="h-[18px] w-[18px]" />
          </RailButton>
        ))}
      </nav>

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

          {activeSection === 'notebook' && <NotebookTree />}
          {activeSection === 'components' && <Palette />}
          {activeSection === 'tools' && <ToolsPanel />}
          {activeSection === 'library' && (
            <LibraryPanel inline open onClose={() => togglePanel('sidebar')} pageId={activePageId} />
          )}
        </div>
      )}
    </fm.aside>
  )
}
