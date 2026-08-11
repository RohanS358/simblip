'use client'

// The "Notebook" sidebar section — three collapsible divisions stacked in
// one scroll column: Notebooks (the existing NotebookTree, unmodified),
// Assignments, and Shared. Assignments and Shared both live inside a
// notebook's worth of pages anyway (importPageDoc lands them there), so
// they read as siblings of the notebook list rather than a separate app
// surface — see docs/superpowers/specs/2026-08-10-unify-assignments-shared-notebook-nav-design.md.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, ChevronDown, ClipboardList, Plus, Share2 } from 'lucide-react'
import { NotebookTree } from './notebook-tree'
import { AssignmentsPanel } from './assignments-panel'
import { SharedPanel } from './shared-panel'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '@/lib/store/workspace'

type SectionId = 'notebooks' | 'assignments' | 'shared'

const STORAGE_KEY = 'simblip-notebook-panel-collapsed'

function loadCollapsed(): Record<SectionId, boolean> {
  const fallback: Record<SectionId, boolean> = { notebooks: false, assignments: false, shared: false }
  if (typeof window === 'undefined') return fallback
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<SectionId, boolean>>
    return { ...fallback, ...saved }
  } catch {
    return fallback
  }
}

function Section({
  id,
  label,
  icon: Icon,
  open,
  onToggle,
  action,
  children,
}: {
  id: SectionId
  label: string
  icon: typeof ClipboardList
  open: boolean
  onToggle: (id: SectionId) => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex min-h-0 flex-col border-b border-border/40 last:border-b-0', open && 'flex-1')}>
      <div className="flex shrink-0 items-center gap-1.5 px-3.5 py-2">
        <button type="button" className="flex flex-1 items-center gap-1.5 text-left" onClick={() => onToggle(id)}>
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
        </button>
        {action}
      </div>
      {open && <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">{children}</div>}
    </div>
  )
}

export function NotebookPanel() {
  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>(() => loadCollapsed())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed))
    } catch {}
  }, [collapsed])

  const toggle = (id: SectionId) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Section
        id="notebooks"
        label="Notebooks"
        icon={ClipboardList}
        open={!collapsed.notebooks}
        onToggle={toggle}
        action={
          <button
            type="button"
            title="New notebook"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              const store = useWorkspaceStore
              const id = store.getState().addNotebook()
              const sec = store.getState().addFolder('Section 1', id)
              store.getState().addPageIn(sec, 'Page 1')
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        }
      >
        <NotebookTree />
      </Section>
      <Section
        id="assignments"
        label="Assignments"
        icon={ClipboardList}
        open={!collapsed.assignments}
        onToggle={toggle}
        action={
          <Link
            href="/assignments/insights"
            title="Insights"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <div className="px-1">
          <AssignmentsPanel compact />
        </div>
      </Section>
      <Section id="shared" label="Shared" icon={Share2} open={!collapsed.shared} onToggle={toggle}>
        <SharedPanel />
      </Section>
    </div>
  )
}
