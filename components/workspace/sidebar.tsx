'use client'

// The left dock's content — an activity-bar rail (Notebook / Components /
// Tools / Library) plus whichever ONE section is open. Replaces the old
// permanent 54/46 split between the notebook tree and the library: now each
// section gets the panel's full height when it's open, and the rail alone
// (no content pane) is the "collapsed, maximum canvas" state.
//
// This is also where the physics/circuit Palette and the Calculator's
// trigger live now — they used to be floating popups pinned to the dock;
// browsers belong in a browsable drawer, not a flyout. See
// docs/ui-simplification-plan.md §4.

import { useState } from 'react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkspaceStore } from '@/lib/store/workspace'
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

  const [activeSection, setActiveSection] = useState<SidebarSectionId | null>(() => {
    if (typeof window === 'undefined') return 'notebook'
    const saved = localStorage.getItem('simblip-sidebar-section')
    return saved === 'none' ? null : (saved as SidebarSectionId | null) ?? 'notebook'
  })

  const [panelW, setPanelW] = useState(() => {
    if (typeof window === 'undefined') return 288
    return Number(localStorage.getItem('simblip-sidebar-w')) || 288
  })

  const selectSection = (id: SidebarSectionId) => {
    const next = activeSection === id ? null : id
    setActiveSection(next)
    try {
      localStorage.setItem('simblip-sidebar-section', next ?? 'none')
    } catch {}
  }

  return (
    <fm.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={motion}
      className="glass relative z-30 m-3 flex min-h-0 flex-row rounded-2xl"
      style={{ width: activeSection ? RAIL_W + panelW : RAIL_W }}
      aria-label="Sidebar"
    >
      <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 py-3">
        {SIDEBAR_SECTIONS.map((s) => (
          <RailButton
            key={s.id}
            label={s.label}
            active={activeSection === s.id}
            onClick={() => selectSection(s.id)}
          >
            <s.icon className="h-[18px] w-[18px]" />
          </RailButton>
        ))}
      </nav>

      {activeSection && (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-border/50">
          <div
            role="separator"
            aria-label="Resize sidebar"
            className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
            onPointerDown={(e) => {
              e.preventDefault()
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
            <LibraryPanel inline open onClose={() => selectSection('library')} pageId={activePageId} />
          )}
        </div>
      )}
    </fm.aside>
  )
}
