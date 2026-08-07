'use client'

// Workspace tree: arbitrary-depth folders containing folders, pages, or raw
// uploaded files (metadata only) — a "notebook" is just a folder with
// parentId===null, see lib/scene/types.ts's Node union doc comment.
// Content lives in the document store; splitting them keeps tree operations
// cheap and gives undo/redo a clean per-page scope.
//
// The tree is stored FLAT (Record<string, Node>, id -> node), not as nested
// children arrays: every existing consumer already looks nodes up by id, a
// flat map makes that O(1) instead of O(depth), and reparenting a node
// (moveNode) is a single field write instead of a splice-out/splice-in
// across two parents. Rendering still needs parent->children groups — that's
// a cheap filter over Object.values, not something that needs to live in the
// persisted shape (see childrenOf below).

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uid, type FileNode, type FolderNode, type Node, type PageKind, type PageNode } from '@/lib/scene/types'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import { migrateNotebooksToNodes } from '@/lib/store/migrate-tree'

/** A node's direct parent lookup. */
export function findNode(nodes: Record<string, Node>, id: string | null): Node | null {
  return id ? (nodes[id] ?? null) : null
}

/** Direct children of a parent, sorted by `order`. parentId=null → top-level folders ("notebooks"). */
export function childrenOf(nodes: Record<string, Node>, parentId: string | null): Node[] {
  return Object.values(nodes)
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order)
}

/** Every descendant (folders, pages, files) under a node, depth-first. */
export function descendantsOf(nodes: Record<string, Node>, id: string): Node[] {
  const out: Node[] = []
  const walk = (parentId: string) => {
    for (const child of childrenOf(nodes, parentId)) {
      out.push(child)
      if (child.kind === 'folder') walk(child.id)
    }
  }
  walk(id)
  return out
}

/** Walk up to the top-level folder ("notebook") that owns a node. */
export function topFolderOf(nodes: Record<string, Node>, id: string | null): FolderNode | null {
  let cur = findNode(nodes, id)
  while (cur && cur.parentId !== null) cur = findNode(nodes, cur.parentId)
  return cur?.kind === 'folder' ? cur : null
}

const patchNode = (nodes: Record<string, Node>, id: string, patch: Record<string, unknown>): Record<string, Node> =>
  nodes[id] ? { ...nodes, [id]: { ...nodes[id], ...patch } as Node } : nodes

/** @deprecated Compat wrapper for call sites not yet migrated to findNode —
 *  find a page's metadata anywhere in the tree by id. */
export const findPageMeta = (nodes: Record<string, Node>, id: string | null): PageNode | null => {
  const n = findNode(nodes, id)
  return n?.kind === 'page' ? n : null
}

/** @deprecated Compat wrapper — which top-level folder ("notebook") owns a node. */
export const findNotebookId = (nodes: Record<string, Node>, id: string | null): string | null =>
  topFolderOf(nodes, id)?.id ?? null

interface WorkspaceState {
  nodes: Record<string, Node>
  activePageId: string | null
  /** Session tabs — every page currently open in the header tab strip. */
  openTabs: string[]
  /** Left pane while split (falls back to activePageId when not split). */
  primaryPageId: string | null
  /** Second split-screen pane (a page id), or null for single view. */
  splitPageId: string | null
  /** Width fraction of the FIRST pane when split. */
  splitRatio: number
  /** Doc pages: the sheet (content page) the tools currently target. */
  activeSheetId: string | null
  /** PDF reader: true while a document is loaded — the shell keeps the real
   *  board dock (Toolbar/Transport) mounted, targeting activeSheetId (either
   *  the current page's on-page ink layer or an open notes sheet). PDF pages
   *  draw with the same pen/eraser/undo as a board, not a bespoke tool. */
  pdfToolsActive: boolean
  sidebarOpen: boolean
  inspectorOpen: boolean
  /** The sticky calculator — its trigger lives in the sidebar's Tools
   *  section now, not the dock, but it still floats over the canvas. */
  calcOpen: boolean
  fullscreenObjectId: string | null
  touchOrthoPen: boolean
  touchFreeMove: boolean
  touchMeasureMode: boolean
  splitScreenDocumentId: string | null
  syncScroll: boolean

  /** Create a top-level folder ("notebook"). */
  addFolder: (name: string | undefined, parentId: string | null) => string
  /** @deprecated thin wrapper for addFolder(name, null) — notebook UI copy. */
  addNotebook: (name?: string) => string
  /** Generic rename — works on a folder, page, or file node. */
  renameNode: (id: string, name: string) => void
  /** @deprecated alias for renameNode. */
  renameNotebook: (id: string, name: string) => void
  /** @deprecated alias for renameNode. */
  renamePage: (pageId: string, name: string) => void
  /** Only valid on a top-level folder (parentId===null); no-ops otherwise. */
  setFolderCover: (id: string, cover: string | undefined) => void
  /** @deprecated alias for setFolderCover. */
  setNotebookCover: (id: string, cover: string | undefined) => void
  /** Only valid on a non-top-level folder ("section", parentId!==null); the
   *  dot color shown in NotebookTree/mobile-shell. No-ops otherwise. */
  setFolderColor: (id: string, color: string) => void
  /** Recursive delete — a folder takes every descendant with it (pages'
   *  content is cleaned up via forgetPage, files via deleteFiles). */
  removeNode: (id: string) => void
  /** @deprecated alias for removeNode. */
  removeNotebook: (id: string) => void
  /** @deprecated alias for removeNode. */
  removePage: (pageId: string) => void
  /** Reparent a node. Refuses folder-into-own-subtree cycles and non-folder
   *  targets. `order` sets sibling position; defaults to end-of-list. */
  moveNode: (id: string, newParentId: string | null, order?: number) => void
  /** @deprecated alias for addFolder(name, notebookId) — a Section IS a folder now. */
  addSection: (notebookId: string, name?: string) => string
  /** @deprecated alias for renameNode. */
  renameSection: (notebookId: string, id: string, name: string) => void
  /** @deprecated alias for removeNode. */
  removeSection: (notebookId: string, id: string) => void
  /** Create a page under parentId (one parentId now, not two). */
  addPageIn: (parentId: string, name?: string, kind?: PageKind) => string
  /** @deprecated alias for addPageIn(sectionId, name, kind) — sectionId is
   *  already a valid parentId (a section IS a folder), notebookId is unused. */
  addPage: (notebookId: string, sectionId: string, name?: string, kind?: PageKind) => string
  /** Create a file-kind leaf under parentId. The manifest entry (fileId)
   *  must already exist — call lib/storage/manager's putFile first. */
  addFile: (parentId: string, name: string, fileId: string, mime: string, size: number) => string
  updatePageMeta: (pageId: string, patch: Partial<Omit<PageNode, 'id' | 'kind' | 'parentId'>>) => void
  /** Link a FileNode to its lazily-created viewer/editor page — see
   *  FileNode.pageId and components/workspace/open-file.ts. */
  setFilePageId: (fileNodeId: string, pageId: string) => void
  /** Append a fresh sheet to a doc/pptx page; returns its content-page id.
   *  pptx pages ("slides") use the same docPages array as doc ("sheets") —
   *  a presentation IS a doc, just rendered as a slide deck instead of a
   *  scrolling document (see presentation-view.tsx). */
  addDocSheet: (pageId: string) => string
  /** Content page for the notes linked to one PDF page (created on demand). */
  ensureNotesPage: (pageId: string, pdfPage: number) => string
  /** Content page for direct on-page ink on one PDF page (created on demand). */
  ensureAnnotPage: (pageId: string, pdfPage: number) => string
  setActivePage: (id: string | null) => void
  closeTab: (id: string) => void
  openSplit: (id: string) => void
  /** Snap-assist: a tab dragged onto the left or right half of the canvas. */
  dropTab: (id: string, side: 'left' | 'right') => void
  closeSplit: (keep?: 'primary' | 'split') => void
  setSplitRatio: (f: number) => void
  setActiveSheet: (id: string | null) => void
  togglePanel: (panel: 'sidebar' | 'inspector' | 'calc') => void
  setFullscreenObject: (id: string | null) => void
  toggleTouchOrthoPen: () => void
  toggleTouchFreeMove: () => void
  toggleTouchMeasureMode: () => void
  setSplitScreenDocumentId: (id: string | null) => void
  setSyncScroll: (sync: boolean) => void
}

export const SECTION_COLORS = ['blue', 'mint', 'amber', 'violet', 'rose']

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      nodes: {},
      activePageId: null,
      openTabs: [],
      primaryPageId: null,
      splitPageId: null,
      splitRatio: 0.5,
      activeSheetId: null,
      pdfToolsActive: false,
      sidebarOpen: true,
      inspectorOpen: true,
      calcOpen: false,
      fullscreenObjectId: null,
      setFullscreenObject: (id) => set({ fullscreenObjectId: id }),
      touchOrthoPen: false,
      touchFreeMove: false,
      touchMeasureMode: false,
      splitScreenDocumentId: null,
      syncScroll: false,

      addFolder: (name = 'New Folder', parentId) => {
        const id = uid()
        set((s) => {
          const siblings = childrenOf(s.nodes, parentId)
          const node: FolderNode = {
            id,
            parentId,
            kind: 'folder',
            name,
            order: siblings.length,
            ...(parentId === null
              ? { emoji: '📓' }
              : { color: SECTION_COLORS[siblings.length % SECTION_COLORS.length] }),
          }
          return { nodes: { ...s.nodes, [id]: node } }
        })
        return id
      },
      addNotebook: (name = 'Untitled Notebook') => get().addFolder(name, null),

      renameNode: (id, name) => set((s) => ({ nodes: patchNode(s.nodes, id, { name }) })),
      renameNotebook: (id, name) => get().renameNode(id, name),
      renamePage: (pageId, name) => get().renameNode(pageId, name),

      setFolderCover: (id, cover) =>
        set((s) => {
          const n = s.nodes[id]
          if (!n || n.kind !== 'folder' || n.parentId !== null) return s
          return { nodes: patchNode(s.nodes, id, { cover }) }
        }),
      setNotebookCover: (id, cover) => get().setFolderCover(id, cover),

      setFolderColor: (id, color) =>
        set((s) => {
          const n = s.nodes[id]
          if (!n || n.kind !== 'folder' || n.parentId === null) return s
          return { nodes: patchNode(s.nodes, id, { color }) }
        }),

      removeNode: (id) => {
        // Deleting a page is the ONE case where content should really go —
        // forgetPage drops it from memory, from the local archive, and
        // queues the cloud deletion. (Merely closing a page must never do
        // this; see lib/store/deleted-pages.ts.) A deleted FOLDER takes
        // every descendant with it (pages AND files), not just its direct
        // children — this generalizes what removeNotebook/removeSection used
        // to hand-roll as two different one/two-level flatMaps.
        const nodes = get().nodes
        const target = findNode(nodes, id)
        if (!target) return
        const toDelete = [target, ...(target.kind === 'folder' ? descendantsOf(nodes, id) : [])]
        const pageNodes = toDelete.filter((n): n is PageNode => n.kind === 'page')
        const contentIds = pageNodes.flatMap((p) => [
          p.id,
          ...(p.docPages ?? []), // doc sheets AND pptx slides — same field
          ...(p.notesPages ?? []).filter(Boolean),
          ...(p.imageAnnotPageId ? [p.imageAnnotPageId] : []),
        ])
        void import('@/lib/store/document').then(({ useDocStore }) =>
          contentIds.forEach((cid) => useDocStore.getState().forgetPage(cid))
        )
        const fileIds = toDelete.filter((n): n is FileNode => n.kind === 'file').map((f) => f.fileId)
        if (fileIds.length) void import('@/lib/storage/manager').then(({ deleteFiles }) => deleteFiles(fileIds))
        // xlsx content lives outside useDocStore (see file-page-content.ts) —
        // clean it up here too, same as contentIds above does for scene-object pages.
        void import('@/lib/store/file-page-content').then(({ useFilePageContentStore }) =>
          pageNodes.forEach((p) => useFilePageContentStore.getState().forgetContent(p.id))
        )
        const deleteSet = new Set(toDelete.map((n) => n.id))
        set((s) => {
          const nextNodes = { ...s.nodes }
          deleteSet.forEach((did) => delete nextNodes[did])
          return {
            nodes: nextNodes,
            activePageId: deleteSet.has(s.activePageId ?? '') ? null : s.activePageId,
            openTabs: s.openTabs.filter((t) => !deleteSet.has(t)),
            splitPageId: deleteSet.has(s.splitPageId ?? '') ? null : s.splitPageId,
            primaryPageId: deleteSet.has(s.primaryPageId ?? '') ? null : s.primaryPageId,
          }
        })
      },
      removeNotebook: (id) => get().removeNode(id),
      removePage: (pageId) => get().removeNode(pageId),

      addSection: (notebookId, name = 'New Section') => get().addFolder(name, notebookId),
      renameSection: (_notebookId, id, name) => get().renameNode(id, name),
      removeSection: (_notebookId, id) => get().removeNode(id),

      moveNode: (id, newParentId, order) => {
        const nodes = get().nodes
        const node = nodes[id]
        if (!node) return
        if (newParentId !== null) {
          const target = nodes[newParentId]
          if (!target || target.kind !== 'folder') return
          // Cycle check: newParentId must not be `id` or any descendant of `id`.
          let cur: string | null = newParentId
          while (cur) {
            if (cur === id) return
            cur = nodes[cur]?.parentId ?? null
          }
        }
        const siblingOrder = order ?? Math.max(0, ...childrenOf(nodes, newParentId).map((n) => n.order)) + 1
        set((s) => ({ nodes: patchNode(s.nodes, id, { parentId: newParentId, order: siblingOrder }) }))
      },

      addPageIn: (parentId, name = 'Untitled Page', kind = 'board') => {
        const id = uid()
        set((s) => {
          const siblings = childrenOf(s.nodes, parentId)
          // A doc starts with one sheet; a board/pdf carries its own content.
          const node: PageNode = {
            id,
            parentId,
            kind: 'page',
            name,
            pageKind: kind,
            order: siblings.length,
            ...(kind === 'doc' ? { docPages: [uid()] } : {}),
          }
          return {
            nodes: { ...s.nodes, [id]: node },
            activePageId: id,
            openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
          }
        })
        return id
      },
      addPage: (_notebookId, sectionId, name, kind) => get().addPageIn(sectionId, name, kind),

      addFile: (parentId, name, fileId, mime, size) => {
        const id = uid()
        set((s) => {
          const siblings = childrenOf(s.nodes, parentId)
          const node: FileNode = { id, parentId, kind: 'file', name, fileId, mime, size, order: siblings.length }
          return { nodes: { ...s.nodes, [id]: node } }
        })
        return id
      },

      updatePageMeta: (pageId, patch) => set((s) => ({ nodes: patchNode(s.nodes, pageId, patch) })),
      setFilePageId: (fileNodeId, pageId) => set((s) => ({ nodes: patchNode(s.nodes, fileNodeId, { pageId }) })),

      addDocSheet: (pageId) => {
        const sheetId = uid()
        set((s) => {
          const meta = findPageMeta(s.nodes, pageId)
          return { nodes: patchNode(s.nodes, pageId, { docPages: [...(meta?.docPages ?? []), sheetId] }) }
        })
        return sheetId
      },

      ensureNotesPage: (pageId, pdfPage) => {
        const meta = findPageMeta(get().nodes, pageId)
        const existing = meta?.notesPages?.[pdfPage - 1]
        if (existing) return existing
        const noteId = uid()
        set((s) => {
          const m = findPageMeta(s.nodes, pageId)
          const notes = [...(m?.notesPages ?? [])]
          while (notes.length < pdfPage) notes.push('')
          notes[pdfPage - 1] = noteId
          return { nodes: patchNode(s.nodes, pageId, { notesPages: notes }) }
        })
        return noteId
      },

      ensureAnnotPage: (pageId, pdfPage) => {
        const meta = findPageMeta(get().nodes, pageId)
        const existing = meta?.annotPages?.[pdfPage - 1]
        if (existing) return existing
        const annotId = uid()
        set((s) => {
          const m = findPageMeta(s.nodes, pageId)
          const annots = [...(m?.annotPages ?? [])]
          while (annots.length < pdfPage) annots.push('')
          annots[pdfPage - 1] = annotId
          return { nodes: patchNode(s.nodes, pageId, { annotPages: annots }) }
        })
        return annotId
      },

      setActivePage: (id) =>
        set((s) => {
          const openTabs = id && !s.openTabs.includes(id) ? [...s.openTabs, id] : s.openTabs
          // Split open and a page picked that isn't in either pane: it replaces
          // whichever pane currently has focus, so the split survives browsing.
          if (s.splitPageId && id && id !== s.splitPageId && id !== s.primaryPageId) {
            if (s.activePageId === s.splitPageId)
              return { activePageId: id, splitPageId: id, openTabs }
            return { activePageId: id, primaryPageId: id, openTabs }
          }
          return { activePageId: id, ...(s.splitPageId ? {} : { primaryPageId: id }), openTabs }
        }),

      closeTab: (id) =>
        set((s) => {
          const openTabs = s.openTabs.filter((t) => t !== id)
          const fallback = openTabs[openTabs.length - 1] ?? null
          return {
            openTabs,
            splitPageId: s.splitPageId === id ? null : s.splitPageId,
            primaryPageId: s.primaryPageId === id ? fallback : s.primaryPageId,
            activePageId: s.activePageId === id ? fallback : s.activePageId,
          }
        }),

      openSplit: (id) =>
        set((s) => {
          // Left pane keeps what you were on; the new page opens on the right.
          const primary =
            s.activePageId && s.activePageId !== id
              ? s.activePageId
              : (s.openTabs.find((t) => t !== id) ?? null)
          if (!primary) return { activePageId: id, primaryPageId: id, openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id] }
          return {
            splitPageId: id,
            primaryPageId: primary,
            activePageId: id,
            openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
          }
        }),

      dropTab: (id, side) =>
        set((s) => {
          const openTabs = s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id]
          const left = s.primaryPageId ?? s.activePageId
          if (side === 'right') {
            if (s.splitPageId === id) return { openTabs, activePageId: id } // already there
            if (left === id) {
              // The current page dragged right: whatever sat in the split (or
              // the next tab) becomes the left pane.
              const other = s.splitPageId ?? openTabs.find((t) => t !== id) ?? null
              if (!other) return { openTabs }
              return { openTabs, primaryPageId: other, splitPageId: id, activePageId: id }
            }
            return { openTabs, primaryPageId: left, splitPageId: id, activePageId: id }
          }
          // side === 'left'
          if (s.splitPageId === id) {
            // Right pane dragged left → the panes swap.
            return { openTabs, primaryPageId: id, splitPageId: left, activePageId: id }
          }
          if (!s.splitPageId) return { openTabs, activePageId: id, primaryPageId: id }
          return { openTabs, primaryPageId: id, activePageId: id }
        }),

      closeSplit: (keep?: 'primary' | 'split') =>
        set((s) => {
          const id = keep === 'split' ? s.splitPageId : (s.primaryPageId ?? s.activePageId)
          return { splitPageId: null, primaryPageId: id, activePageId: id }
        }),

      setSplitRatio: (f) => set({ splitRatio: Math.min(0.8, Math.max(0.2, f)) }),

      setActiveSheet: (id) => set({ activeSheetId: id }),

      togglePanel: (panel) =>
        set((s) =>
          panel === 'sidebar'
            ? { sidebarOpen: !s.sidebarOpen }
            : panel === 'inspector'
              ? { inspectorOpen: !s.inspectorOpen }
              : { calcOpen: !s.calcOpen }
        ),

      toggleTouchOrthoPen: () => set((s) => ({ touchOrthoPen: !s.touchOrthoPen })),
      toggleTouchFreeMove: () => set((s) => ({ touchFreeMove: !s.touchFreeMove })),
      toggleTouchMeasureMode: () => set((s) => ({ touchMeasureMode: !s.touchMeasureMode })),
      setSplitScreenDocumentId: (id) => set({ splitScreenDocumentId: id }),
      setSyncScroll: (syncScroll) => set({ syncScroll }),
    }),
    {
      name: 'simblip-workspace',
      storage: scopedJSONStorage,
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Old persisted blobs still have `notebooks` (an array); new ones
        // have `nodes` (a Record) and no `notebooks` key at all.
        const legacy = (state as unknown as { notebooks?: unknown }).notebooks
        const migrated = migrateNotebooksToNodes(legacy)
        if (migrated) {
          state.nodes = migrated
          // Drop the dead key so the next persisted write is clean — same
          // "reset the old field after archiving it away" the doc-store
          // migration does for its own legacy `pages` field.
          delete (state as unknown as { notebooks?: unknown }).notebooks
        }
      },
    }
  )
)
