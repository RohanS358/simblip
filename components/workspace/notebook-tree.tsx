'use client'

// Notebook (folder) tree, arbitrary depth, with desktop-grade context menus.
// Right-click anything for rename/duplicate/share/assign/present/export.
// Double-click still renames inline; selection drives the active page.
//
// A "Notebook" is just a top-level FolderNode (parentId===null) — the tree
// below it (sections, sub-folders, pages, files) nests to any depth, all
// rendered by the SAME recursive TreeNode component instead of three fixed
// JSX levels the way this file used to hardcode notebook->section->page.
//
// Self-contained on purpose: this is the "Notebook" entry in the shared
// sidebar taxonomy (lib/store/sidebar-sections.ts) — the desktop rail, the
// tablet rail-sheet and the phone drawer all render this exact component,
// so notebook browsing works identically everywhere instead of each shell
// reimplementing its own tree.

import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  ClipboardList,
  CloudUpload,
  Copy,
  Download,
  File as FileIcon,
  Folder,
  LibraryBig,
  MonitorPlay,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore, childrenOf } from '@/lib/store/workspace'
import type { FileNode, FolderNode, Node, PageNode } from '@/lib/scene/types'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { importPageInto } from '@/lib/store/import-page'
import { bundlePage } from '@/lib/store/page-bundle'
import { openFile as openFileNode } from './open-file'
import { KIND_ICON } from './tabs-bar'
import {
  AssignDialog,
  PresentDialog,
  ShareDialog,
  exportPageJson,
  type PageRef,
} from './page-actions'
import { PublishDialog } from './library-panel'
import { AddPageDialog } from './add-page-dialog'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** Route a dropped/picked file into parentId — a PDF, or plain text/markdown/
 *  csv this app can flatten into one, becomes a reader PAGE (paged reading,
 *  per-page ink/notes — a genuinely richer experience worth keeping as a
 *  page for formats with no editable model of their own). pptx/docx/xlsx
 *  become a raw FILE leaf like anything else — opening one (open-file.ts)
 *  creates a real editable doc/xlsx/presentation-kind page on first click,
 *  instead of pre-flattening to a read-only PDF. Anything else (images,
 *  video, audio, arbitrary files) also becomes a raw FILE leaf instead of
 *  being force-converted or silently failing — a real filesystem wouldn't reject
 *  a dropped .png. Shared by the tree's drag-drop handler and the "Upload
 *  file…" menu item so both take the same file through the same path. */
export async function addFileToFolder(parentId: string, f: File) {
  const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
  const isPdf = f.type === 'application/pdf' || ext === '.pdf'
  const isConvertible = ['.txt', '.md', '.csv'].includes(ext)
  if (isPdf || isConvertible) {
    const pageId = useWorkspaceStore.getState().addPageIn(parentId, f.name.replace(/\.[^.]+$/, ''), 'pdf')
    const { attachPdfToPage } = await import('@/lib/store/pdf-attach')
    try {
      await attachPdfToPage(pageId, f)
    } catch {
      // Conversion failed — the page still exists, empty; pdf-view's own
      // dropzone can retry, same fallback add-page-dialog.tsx uses.
    }
    return
  }
  const { putFile } = await import('@/lib/storage/manager')
  const { useAuthStore } = await import('@/lib/auth/store')
  const ownerId = useAuthStore.getState().profile?.id ?? 'anon'
  const fileId = await putFile(f, f.name, f.type || 'application/octet-stream', ownerId)
  useWorkspaceStore.getState().addFile(parentId, f.name, fileId, f.type || 'application/octet-stream', f.size)
}

const SECTION_DOT: Record<string, string> = {
  blue: 'bg-[var(--accent-blue)]',
  mint: 'bg-[var(--accent-mint)]',
  amber: 'bg-[var(--accent-amber)]',
  violet: 'bg-[var(--accent-violet)]',
  rose: 'bg-[var(--accent-rose)]',
}

/** The auto-created notebook incoming shares land in — see
 *  hooks/use-share-inbox.ts. Single source of truth for the name so the
 *  desktop Shared panel, the mobile Shared tab, and the Home grid's
 *  exclusion filter can't drift out of sync. */
export const SHARED_NB = 'Shared with me'

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
  const inputRef = useRef<HTMLInputElement>(null)
  // Not autoFocus: when rename is entered via the context menu's "Rename"
  // item, Radix returns focus to the menu's trigger row asynchronously as
  // its menu unmounts — sometimes in the same tick this input mounts,
  // sometimes a frame or two later (its own cleanup timing, not ours) — so
  // a single requestAnimationFrame isn't reliably late enough to win the
  // race every time. Re-asserting focus for a few frames covers whichever
  // tick Radix's focus-return lands on, without an indefinite retry loop.
  useEffect(() => {
    if (!active) return
    let frame = 0
    let raf = 0
    const tick = () => {
      const el = inputRef.current
      if (!el || document.activeElement === el) return
      el.focus()
      if (++frame < 5) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  if (active) {
    return (
      <input
        ref={inputRef}
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

/** Shared handlers every tree row needs — passed down instead of re-derived
 *  at each recursion level. */
export interface TreeHandlers {
  activePageId: string | null
  renaming: string | null
  setRenaming: (id: string | null) => void
  selectPage: (id: string) => void
  duplicatePage: (parentId: string, page: PageRef) => void
  setAddTarget: (t: { parentId: string } | null) => void
  setShareFor: (p: PageRef | null) => void
  setAssignFor: (p: PageRef | null) => void
  setPresentFor: (p: PageRef | null) => void
  setPublishFor: (p: PageRef | null) => void
  staff: boolean
  collapsed: Record<string, boolean>
  toggleCollapsed: (id: string) => void
  /** Opens the native file picker, uploading whatever's chosen into
   *  parentId — same PDF-vs-raw-file routing the drag-drop handler uses. */
  uploadFileTo: (parentId: string) => void
  /** Opens a raw uploaded file as a tab, lazily creating its viewer/editor
   *  page on first open — see open-file.ts. No-ops for an unsupported mime. */
  openFile: (node: FileNode) => void
}

function FolderRow({ node, depth, handlers }: { node: FolderNode; depth: number; handlers: TreeHandlers }) {
  const store = useWorkspaceStore
  const children = useWorkspaceStore(useShallow((s) => childrenOf(s.nodes, node.id)))
  const isNotebook = node.parentId === null
  const isCollapsed = handlers.collapsed[node.id]
  const [dropOver, setDropOver] = useState(false)

  return (
    <div className={cn(depth > 0 && 'ml-4', isNotebook ? 'mt-1.5' : 'mt-0.5')}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'group flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-accent/50',
              isNotebook ? 'text-[0.8125rem] font-semibold py-1.5' : 'gap-2 text-[0.78125rem] font-medium text-muted-foreground',
              dropOver && 'ring-2 ring-inset ring-[var(--accent-blue)]/60 bg-[var(--accent-blue)]/5'
            )}
            // ── DnD: accept both OS files and internal node moves ──
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-simblip-node', JSON.stringify({ id: node.id, kind: 'folder' }))
              e.dataTransfer.effectAllowed = 'move'
              // Prevent drag from also triggering parent handlers
              e.stopPropagation()
            }}
            onDragOver={(e) => {
              const hasFile = e.dataTransfer.types.includes('Files')
              const hasNode = e.dataTransfer.types.includes('application/x-simblip-node')
              if (!hasFile && !hasNode) return
              e.preventDefault()
              e.stopPropagation()
              setDropOver(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as unknown as Element)) setDropOver(false)
            }}
            onDrop={(e) => {
              setDropOver(false)
              e.preventDefault()
              e.stopPropagation()
              // Internal node move
              const nodeData = e.dataTransfer.getData('application/x-simblip-node')
              if (nodeData) {
                try {
                  const { id: draggedId } = JSON.parse(nodeData) as { id: string; kind: string }
                  if (draggedId !== node.id) store.getState().moveNode(draggedId, node.id)
                } catch { /* ignore bad JSON */ }
                return
              }
              // External OS file drop
              const f = e.dataTransfer.files?.[0]
              if (f) void addFileToFolder(node.id, f)
            }}
          >
            <button
              type="button"
              aria-label={isCollapsed ? 'Expand folder' : 'Collapse folder'}
              onClick={() => handlers.toggleCollapsed(node.id)}
              className="text-muted-foreground"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', !isCollapsed && 'rotate-90')} />
            </button>
            {isNotebook ? (
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <span className={cn('h-2 w-2 rounded-full', SECTION_DOT[node.color ?? 'blue'] ?? SECTION_DOT.blue)} />
            )}
            <InlineName
              name={node.name}
              className="flex-1"
              editing={handlers.renaming === node.id}
              onEditDone={() => handlers.setRenaming(null)}
              onRename={(name) => store.getState().renameNode(node.id, name)}
            />
            <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label="New folder"
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  store.getState().addFolder('New Folder', node.id)
                }}
              >
                <Folder className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Add page"
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  handlers.setAddTarget({ parentId: node.id })
                }}
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Rename"
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  handlers.setRenaming(node.id)
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${isNotebook ? 'notebook' : 'folder'}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  store.getState().removeNode(node.id)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => store.getState().addFolder('New Folder', node.id)}>
            <Folder className="h-4 w-4" /> New folder
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handlers.setAddTarget({ parentId: node.id })}>
            <Plus className="h-4 w-4" /> Add page…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handlers.uploadFileTo(node.id)}>
            <FileIcon className="h-4 w-4" /> Upload file…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handlers.setRenaming(node.id)}>
            <Pencil className="h-4 w-4" /> Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => store.getState().removeNode(node.id)}>
            <Trash2 className="h-4 w-4" /> Delete {isNotebook ? 'notebook' : 'folder'}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Children stay mounted; the grid row folds to 0fr so collapse
          animates and re-clicks retarget mid-motion. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-strong',
          isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} handlers={handlers} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PageRow({ node, depth, handlers }: { node: PageNode; depth: number; handlers: TreeHandlers }) {
  const store = useWorkspaceStore
  const KindIcon = KIND_ICON[node.pageKind ?? 'board']
  const active = handlers.activePageId === node.id

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group ml-4 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[0.78125rem] transition-colors',
            active
              ? 'bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] font-semibold text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          )}
          style={{ marginLeft: `${depth * 16}px` }}
          // ── DnD: dragging a page chip sets both tokens ──
          // application/x-simblip-tab → canvas drop-to-split (shell.tsx)
          // application/x-simblip-node → tree folder drop (reparent)
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-simblip-tab', node.id)
            e.dataTransfer.setData('application/x-simblip-node', JSON.stringify({ id: node.id, kind: 'page' }))
            e.dataTransfer.effectAllowed = 'move'
            e.stopPropagation()
          }}
          onClick={() => handlers.selectPage(node.id)}
        >
          <KindIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <InlineName
            name={node.name}
            className="flex-1"
            editing={handlers.renaming === node.id}
            onEditDone={() => handlers.setRenaming(null)}
            onRename={(name) => store.getState().renameNode(node.id, name)}
          />
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              aria-label="Rename"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation()
                handlers.setRenaming(node.id)
              }}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="Delete page"
              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                store.getState().removeNode(node.id)
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => handlers.selectPage(node.id)}>
          <BookOpen className="h-4 w-4" /> Open
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handlers.setRenaming(node.id)}>
          <Pencil className="h-4 w-4" /> Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => node.parentId && handlers.duplicatePage(node.parentId, node)}>
          <Copy className="h-4 w-4" /> Duplicate
        </ContextMenuItem>
        {handlers.staff && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handlers.setShareFor(node)}>
              <Share2 className="h-4 w-4" /> Share copy…
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handlers.setAssignFor(node)}>
              <ClipboardList className="h-4 w-4" /> Assign…
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handlers.setPresentFor(node)}>
              <MonitorPlay className="h-4 w-4" /> Present on room board…
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handlers.setPublishFor(node)}>
              <LibraryBig className="h-4 w-4" /> Add to library…
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => exportPageJson(node)}>
          <Download className="h-4 w-4" /> Export JSON
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => store.getState().removeNode(node.id)}>
          <Trash2 className="h-4 w-4" /> Delete page
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A raw uploaded file, direct leaf of a folder (not wrapped in a page). */
function FileRow({ node, depth, handlers }: { node: FileNode; depth: number; handlers: TreeHandlers }) {
  const store = useWorkspaceStore
  // Per-file cross-device sync, opt-in (see manifest-types.ts). Read lazily
  // when the menu opens rather than on every tree render — this is one
  // IndexedDB hit per file row otherwise, on a tree that can be hundreds of
  // rows long.
  const [syncOn, setSyncOn] = useState<boolean | null>(null)
  const loadSyncState = () => {
    void import('@/lib/storage/manager').then(({ isSyncEnabled }) =>
      isSyncEnabled(node.fileId).then(setSyncOn)
    )
  }
  const toggleSync = () => {
    const next = !syncOn
    setSyncOn(next) // optimistic — the write below can't meaningfully fail
    void import('@/lib/storage/manager').then(({ setSyncEnabled }) =>
      setSyncEnabled(node.fileId, next)
    )
  }
  return (
    <ContextMenu onOpenChange={(open) => open && loadSyncState()}>
      <ContextMenuTrigger asChild>
        <div
          className="group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[0.78125rem] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          style={{ marginLeft: `${16 + depth * 16}px` }}
          // also tag as a node so folders can reparent it.
          draggable
          onDragStart={(e) => {
            // File nodes only support tree-reparenting (simblip-node), NOT
            // canvas tab-drop (simblip-tab). Opening a file belongs to the
            // click handler; dragging should only move it within the tree.
            e.dataTransfer.setData('application/x-simblip-node', JSON.stringify({ id: node.id, kind: 'file' }))
            e.dataTransfer.effectAllowed = 'move'
            e.stopPropagation()
          }}
          onClick={() => handlers.openFile(node)}
        >
          <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <InlineName
            name={node.name}
            className="flex-1"
            editing={handlers.renaming === node.id}
            onEditDone={() => handlers.setRenaming(null)}
            onRename={(name) => store.getState().renameNode(node.id, name)}
          />
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              aria-label="Rename"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation()
                handlers.setRenaming(node.id)
              }}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="Delete file"
              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                store.getState().removeNode(node.id)
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => handlers.openFile(node)}>
          <BookOpen className="h-4 w-4" /> Open
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handlers.setRenaming(node.id)}>
          <Pencil className="h-4 w-4" /> Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* Opt-in per file: OFF means the bytes never leave this device, which
            is why a file can look "missing" on another one — the manifest row
            syncs, the content doesn't. Checkbox item so the current state is
            visible without opening a dialog. */}
        <ContextMenuCheckboxItem
          checked={syncOn === true}
          disabled={syncOn === null}
          onCheckedChange={toggleSync}
          onSelect={(e) => e.preventDefault()} // keep the menu open on toggle
        >
          <CloudUpload className="h-4 w-4" /> Sync across devices
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => store.getState().removeNode(node.id)}>
          <Trash2 className="h-4 w-4" /> Delete file
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function TreeNode({ node, depth, handlers }: { node: Node; depth: number; handlers: TreeHandlers }) {
  if (node.kind === 'folder') return <FolderRow node={node} depth={depth} handlers={handlers} />
  if (node.kind === 'page') return <PageRow node={node} depth={depth} handlers={handlers} />
  return <FileRow node={node} depth={depth} handlers={handlers} />
}

export function NotebookTree({ onSelectPage }: { onSelectPage?: () => void }) {
  const roots = useWorkspaceStore(useShallow((s) => childrenOf(s.nodes, null)))
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const store = useWorkspaceStore

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)
  const [addTarget, setAddTarget] = useState<{ parentId: string } | null>(null)

  const staff = can(role, 'share-pages')

  const duplicatePage = (parentId: string, page: PageRef) => {
    // Bundle-aware: duplicating a doc keeps its sheets, a PDF keeps its file.
    importPageInto(parentId, parentId, `${page.name} copy`, bundlePage(page.id), true)
  }

  const selectPage = (id: string) => {
    store.getState().setActivePage(id)
    onSelectPage?.()
  }

  const openFile = (node: FileNode) => {
    if (openFileNode(node)) onSelectPage?.()
  }

  // One shared hidden <input type=file> for the whole tree — "Upload file…"
  // stashes which folder to target, then triggers a click, since a context
  // menu item can't open the native picker directly.
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string | null>(null)
  const uploadFileTo = (parentId: string) => {
    uploadTargetRef.current = parentId
    uploadInputRef.current?.click()
  }

  const handlers: TreeHandlers = {
    activePageId,
    renaming,
    setRenaming,
    selectPage,
    duplicatePage,
    setAddTarget,
    setShareFor,
    setAssignFor,
    setPresentFor,
    setPublishFor,
    staff,
    collapsed,
    toggleCollapsed: (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] })),
    uploadFileTo,
    openFile,
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        // Global root drop zone: files dropped anywhere in the tree
        // (not on a specific folder) fall into the first root notebook if any.
        // Internal node drags that miss a folder row move the node to the root.
        onDragOver={(e) => {
          const hasFile = e.dataTransfer.types.includes('Files')
          const hasNode = e.dataTransfer.types.includes('application/x-simblip-node')
          if (hasFile || hasNode) e.preventDefault()
        }}
        onDrop={(e) => {
          // Only handle if the target is the root scroll area itself
          // (folder rows stop propagation, so this only fires for misses).
          // Internal node move: reparent to the first root notebook/folder.
          const nodeData = e.dataTransfer.getData('application/x-simblip-node')
          if (nodeData) {
            e.preventDefault()
            try {
              const { id: draggedId } = JSON.parse(nodeData) as { id: string; kind: string }
              const firstRoot = roots[0]
              if (firstRoot && draggedId !== firstRoot.id) {
                store.getState().moveNode(draggedId, firstRoot.id)
              }
            } catch { /* ignore bad JSON */ }
            return
          }
          const f = e.dataTransfer.files?.[0]
          if (!f) return
          const firstRoot = roots[0]
          if (!firstRoot) return
          e.preventDefault()
          void addFileToFolder(firstRoot.id, f)
        }}
      >
        {roots.filter((nb) => nb.name !== SHARED_NB).length === 0 && (
          <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
            <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
              No notebooks yet.
              <br />
              Create one to start working.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-border/60 px-2.5 py-1 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => {
                  const id = store.getState().addNotebook()
                  const sec = store.getState().addFolder('Section 1', id)
                  store.getState().addPageIn(sec, 'Page 1')
                }}
              >
                New notebook
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 px-2.5 py-1 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => store.getState().addFolder('New Folder', null)}
              >
                New folder
              </button>
            </div>
          </div>
        )}
        {roots
          .filter((nb) => nb.name !== SHARED_NB)
          .map((nb) => (
            <TreeNode key={nb.id} node={nb} depth={0} handlers={handlers} />
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
      <AddPageDialog target={addTarget} onOpenChange={(o) => !o && setAddTarget(null)} onCreated={selectPage} />
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          const parentId = uploadTargetRef.current
          e.target.value = '' // same file picked twice still fires onChange
          if (f && parentId) void addFileToFolder(parentId, f)
        }}
      />
    </div>
  )
}
