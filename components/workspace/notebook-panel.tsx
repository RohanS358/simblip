'use client'

// The "Notebook" sidebar section — ONE view at a time (Notebooks, Shared,
// Assignments), picked by a text filter row at the top.
//
// This used to stack all three as collapsible accordions in a single scroll
// column, which quietly re-introduced the vertical split that
// docs/ui-simplification-plan.md §4 removed from the sidebar itself: "Only one
// section is expanded at a time — no more permanent internal split fighting
// over vertical space. The Notebook tree finally gets the *entire* panel
// height when it's open." Three stacked sections meant the tree got about half
// of it. Now the active view gets all of it, one level down, for the same
// reason the rail works that way one level up.
//
// The three views are unmodified components (NotebookTree, SharedPanel,
// AssignmentsPanel) — each already renders standalone, so switching between
// them is a render choice, not a refactor of any of them.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Plus } from 'lucide-react'
import { NotebookTree } from './notebook-tree'
import { AssignmentsPanel } from './assignments-panel'
import { SharedPanel } from './shared-panel'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '@/lib/store/workspace'

type ViewId = 'notebooks' | 'shared' | 'assignments'

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'notebooks', label: 'Notebooks' },
  { id: 'shared', label: 'Shared' },
  { id: 'assignments', label: 'Assignments' },
]

const STORAGE_KEY = 'simblip-notebook-panel-view'
/** The pre-rework key held three collapsed-booleans. It has no meaning under
 *  one-view-at-a-time, so it's cleared on first load rather than left to rot. */
const LEGACY_KEY = 'simblip-notebook-panel-collapsed'

function loadView(): ViewId {
  if (typeof window === 'undefined') return 'notebooks'
  try {
    localStorage.removeItem(LEGACY_KEY)
    const saved = localStorage.getItem(STORAGE_KEY)
    return VIEWS.some((v) => v.id === saved) ? (saved as ViewId) : 'notebooks'
  } catch {
    return 'notebooks'
  }
}

export function NotebookPanel() {
  const [view, setView] = useState<ViewId>('notebooks')

  // Read after mount, not in the initializer: this panel renders on the
  // server too, and seeding state from localStorage during the first render
  // makes the client tree disagree with the server's.
  useEffect(() => setView(loadView()), [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, view)
    } catch {}
  }, [view])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filter row: plain labels, underline on the active one. The old
          headers carried an icon each, but "Shared" and "Assignments" already
          say what those icons said. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-3 pt-2">
        <div role="tablist" aria-label="Notebook view" className="flex flex-1 items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                'relative rounded-t-md px-2 py-1.5 text-ui-xs transition-colors duration-150 ease-strong',
                'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors after:duration-150',
                view === v.id
                  ? 'font-medium text-foreground after:bg-[var(--accent-blue)]'
                  : 'text-muted-foreground after:bg-transparent hover:text-foreground'
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view === 'notebooks' && (
          <button
            type="button"
            title="New notebook"
            aria-label="New notebook"
            className="mb-1 rounded-md p-1 text-muted-foreground transition-[color,background-color,transform] duration-200 ease-strong hover:bg-accent hover:text-foreground active:scale-90"
            onClick={() => {
              const store = useWorkspaceStore
              const id = store.getState().addNotebook()
              const sec = store.getState().addFolder('Section 1', id)
              store.getState().addPageIn(sec, 'Page 1')
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        {view === 'assignments' && (          <Link
            href="/assignments/insights"
            title="Insights"
            aria-label="Assignment insights"
            className="mb-1 rounded-md p-1 text-muted-foreground transition-[color,background-color,transform] duration-200 ease-strong hover:bg-accent hover:text-foreground active:scale-90"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* The scroll container lives here, not in the views: NotebookTree
          scrolls itself, but SharedPanel and AssignmentsPanel are plain
          content that relied on the old Section wrapper to scroll them. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'notebooks' && <NotebookTree />}
        {view === 'shared' && <SharedPanel />}
        {view === 'assignments' && (
          <div className="px-1">
            <AssignmentsPanel compact />
          </div>
        )}
      </div>
    </div>
  )
}
