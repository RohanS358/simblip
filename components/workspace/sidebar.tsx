'use client'

// Notebook → Section → Page tree with desktop-grade context menus.
// Right-click anything for rename/duplicate/share/assign/present/export.
// Double-click still renames inline; selection drives the active page.

import { useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  LibraryBig,
  MonitorPlay,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { clonePageDoc } from '@/lib/store/import-page'
import {
  AssignDialog,
  PresentDialog,
  ShareDialog,
  exportPageJson,
  type PageRef,
} from './page-actions'
import { PublishDialog } from './library-panel'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'

const SECTION_DOT: Record<string, string> = {
  blue: 'bg-[var(--accent-blue)]',
  mint: 'bg-[var(--accent-mint)]',
  amber: 'bg-[var(--accent-amber)]',
  violet: 'bg-[var(--accent-violet)]',
  rose: 'bg-[var(--accent-rose)]',
}

function InlineName({
  name,
  className,
  editing: editingExternal,
  onEditDone,
  onRename,
}: {
  name: string
  className?: string
  editing?: boolean
  onEditDone?: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const active = editing || editingExternal
  if (active) {
    return (
      <input
        autoFocus
        aria-label="Rename"
        className={cn('w-full rounded bg-accent/60 px-1 outline-none', className)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          setEditing(false)
          onEditDone?.()
          if (draft.trim()) onRename(draft.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
            onEditDone?.()
          }
          e.stopPropagation()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    )
  }
  return (
    <span
      className={cn('truncate', className)}
      onDoubleClick={() => {
        setDraft(name)
        setEditing(true)
      }}
    >
      {name}
    </span>
  )
}

export function Sidebar() {
  const notebooks = useWorkspaceStore((s) => s.notebooks)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const store = useWorkspaceStore

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)

  const staff = can(role, 'share-pages')

  const duplicatePage = (nbId: string, secId: string, page: PageRef) => {
    const newId = store.getState().addPage(nbId, secId, `${page.name} copy`)
    const content = useDocStore.getState().pages[page.id]
    if (content) {
      useDocStore.setState((s) => ({ pages: { ...s.pages, [newId]: clonePageDoc(content) } }))
    }
    useDocStore.getState().ensurePage(newId)
  }

  return (
    <motion.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="glass z-30 m-3 flex w-60 flex-col rounded-2xl"
      aria-label="Notebooks"
    >
      <div className="flex items-center justify-between px-3.5 pb-1 pt-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Notebooks
        </span>
        <button
          type="button"
          aria-label="New notebook"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => {
            const id = store.getState().addNotebook()
            const sec = store.getState().addSection(id, 'Section 1')
            store.getState().addPage(id, sec, 'Page 1')
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {notebooks.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
            No notebooks yet.
            <br />
            Create one to start working.
          </p>
        )}
        {notebooks.map((nb) => (
          <div key={nb.id} className="mt-1.5">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold hover:bg-accent/50">
                  <button
                    type="button"
                    aria-label={collapsed[nb.id] ? 'Expand notebook' : 'Collapse notebook'}
                    onClick={() => setCollapsed((c) => ({ ...c, [nb.id]: !c[nb.id] }))}
                    className="text-muted-foreground"
                  >
                    <ChevronRight
                      className={cn('h-3.5 w-3.5 transition-transform', !collapsed[nb.id] && 'rotate-90')}
                    />
                  </button>
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <InlineName
                    name={nb.name}
                    className="flex-1 text-[13px]"
                    editing={renaming === nb.id}
                    onEditDone={() => setRenaming(null)}
                    onRename={(name) => store.getState().renameNotebook(nb.id, name)}
                  />
                  <button
                    type="button"
                    aria-label="Add section"
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                    onClick={() => store.getState().addSection(nb.id)}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => store.getState().addSection(nb.id)}>
                  <Plus className="h-4 w-4" /> New section
                </ContextMenuItem>
                <ContextMenuItem onClick={() => setRenaming(nb.id)}>
                  <Pencil className="h-4 w-4" /> Rename
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => store.getState().removeNotebook(nb.id)}>
                  <Trash2 className="h-4 w-4" /> Delete notebook
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {!collapsed[nb.id] &&
              nb.sections.map((sec) => (
                <div key={sec.id} className="ml-4 mt-0.5">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div className="group flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted-foreground hover:bg-accent/50">
                        <span className={cn('h-2 w-2 rounded-full', SECTION_DOT[sec.color] ?? SECTION_DOT.blue)} />
                        <InlineName
                          name={sec.name}
                          className="flex-1"
                          editing={renaming === sec.id}
                          onEditDone={() => setRenaming(null)}
                          onRename={(name) => store.getState().renameSection(nb.id, sec.id, name)}
                        />
                        <button
                          type="button"
                          aria-label="Add page"
                          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                          onClick={() => store.getState().addPage(nb.id, sec.id)}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => store.getState().addPage(nb.id, sec.id)}>
                        <Plus className="h-4 w-4" /> New page
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => setRenaming(sec.id)}>
                        <Pencil className="h-4 w-4" /> Rename
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => store.getState().removeSection(nb.id, sec.id)}
                      >
                        <Trash2 className="h-4 w-4" /> Delete section
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  {sec.pages.map((page) => (
                    <ContextMenu key={page.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          className={cn(
                            'group ml-4 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] transition-colors',
                            activePageId === page.id
                              ? 'bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] font-semibold text-foreground'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                          )}
                          onClick={() => store.getState().setActivePage(page.id)}
                        >
                          <InlineName
                            name={page.name}
                            className="flex-1"
                            editing={renaming === page.id}
                            onEditDone={() => setRenaming(null)}
                            onRename={(name) => store.getState().renamePage(page.id, name)}
                          />
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => store.getState().setActivePage(page.id)}>
                          <BookOpen className="h-4 w-4" /> Open
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => setRenaming(page.id)}>
                          <Pencil className="h-4 w-4" /> Rename
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => duplicatePage(nb.id, sec.id, page)}>
                          <Copy className="h-4 w-4" /> Duplicate
                        </ContextMenuItem>
                        {staff && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => setShareFor(page)}>
                              <Share2 className="h-4 w-4" /> Share copy…
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => setAssignFor(page)}>
                              <ClipboardList className="h-4 w-4" /> Assign…
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => setPresentFor(page)}>
                              <MonitorPlay className="h-4 w-4" /> Present on room board…
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => setPublishFor(page)}>
                              <LibraryBig className="h-4 w-4" /> Add to library…
                            </ContextMenuItem>
                          </>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => exportPageJson(page)}>
                          <Download className="h-4 w-4" /> Export JSON
                        </ContextMenuItem>
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => store.getState().removePage(page.id)}
                        >
                          <Trash2 className="h-4 w-4" /> Delete page
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              ))}
          </div>
        ))}
      </div>

      <ShareDialog page={shareFor} onOpenChange={(o) => !o && setShareFor(null)} />
      <AssignDialog page={assignFor} onOpenChange={(o) => !o && setAssignFor(null)} />
      <PresentDialog page={presentFor} onOpenChange={(o) => !o && setPresentFor(null)} />
      <PublishDialog
        open={publishFor !== null}
        onOpenChange={(o) => !o && setPublishFor(null)}
        pageId={publishFor?.id ?? null}
      />
    </motion.aside>
  )
}
