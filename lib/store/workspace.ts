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

/** A content-page id (a board's own id, or one doc/pptx sheet inside
 *  docPages[]) back to the tree PageNode id that owns it — "the whole
 *  document" for things like the custom-color palette, which should survive
 *  switching slides/sheets instead of resetting per-sheet. A board's content
 *  id already IS its PageNode id, so this is the identity for that case. */
export function ownerPageOf(nodes: Record<string, Node>, contentPageId: string): string {
  for (const n of Object.values(nodes)) {
    if (n.kind === 'page' && n.docPages?.includes(contentPageId)) return n.id
  }
  return contentPageId
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

  // ── Multi-pane grid (1–4 panes) ─────────────────────────────────────────
  /** Page IDs currently displayed in the grid. 1 = full canvas, 2 = side by
   *  side, 3 = left + right column (top/bottom), 4 = 2×2. Length capped at 4. */
  panes: string[]
  /** Which pane index (0-based) currently has keyboard / tool focus. */
  activePaneIndex: number

  // ── Legacy 2-pane compat aliases (derived from panes[]) ─────────────────
  /** @deprecated Use panes[0] — Left pane while split (falls back to activePageId when not split). */
  primaryPageId: string | null
  /** @deprecated Use panes[1] — Second split-screen pane, or null for single view. */
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
  /** Create a page under parentId (one parentId now, not two). `activate`
   *  (default true) opens it as the focused pane — pass false for a hidden
   *  backing page (e.g. the linked page behind an embedded Document object)
   *  that must exist in the tree without stealing focus from what's open. */
  addPageIn: (parentId: string, name?: string, kind?: PageKind, activate?: boolean) => string
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
  /** Add a page as a new pane (up to 4). Replaces openSplit for new code. */
  addPane: (id: string) => void
  /** Remove the pane at index. */
  removePane: (index: number) => void
  /** Set focused pane by index. */
  setActivePane: (index: number) => void
  /** Move a pane from one index to another. */
  movePaneTo: (fromIndex: number, toIndex: number) => void
  /** @deprecated Use addPane(id) instead. */
  openSplit: (id: string) => void
  /** Snap-assist: a tab dragged onto the left or right half of the canvas. */
  dropTab: (id: string, side: 'left' | 'right') => void
  /** @deprecated Use removePane(index) instead. */
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

/** Clamp pane count 1–4 and deduplicate while preserving order. */
function dedupePanes(panes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of panes) {
    if (!seen.has(id)) { seen.add(id); out.push(id) }
  }
  return out.slice(0, 4)
}

/** Derive the legacy compat aliases from panes[]. */
function panesAliases(panes: string[], activePaneIndex: number) {
  return {
    primaryPageId: panes[0] ?? null,
    splitPageId: panes[1] ?? null,
    activePageId: panes[activePaneIndex] ?? panes[0] ?? null,
  }
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      nodes: {},
      activePageId: null,
      openTabs: [],
      panes: [],
      activePaneIndex: 0,
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

        // ── OPFS cleanup ───────────────────────────────────────────────────
        // 1. FileNode direct blobs (e.g. raw uploaded files in the tree)
        const fileNodeIds = toDelete.filter((n): n is FileNode => n.kind === 'file').map((f) => f.fileId)

        // 2. PageNode.fileUrl source files ('opfs:<id>') — the original
        //    pptx/pdf/image binary that backs the page viewer/importer.
        const pageSourceFileIds = pageNodes
          .map((p) => p.fileUrl)
          .filter((u): u is string => typeof u === 'string' && u.startsWith('opfs:'))
          .map((u) => u.slice('opfs:'.length))

        // 3. Embedded picture objects inside page content ('opfs:<id>' in
        //    geometry.src). Must be collected NOW before forgetPage evicts
        //    the pages from the doc store's in-memory map.
        void import('@/lib/store/document').then(({ useDocStore }) => {
          const docStore = useDocStore.getState()

          const embeddedImageIds = contentIds.flatMap((cid) =>
            docStore.collectPageOpfsRefs(cid)
          )

          // Batch-delete all OPFS blobs + manifest entries + cloud copies.
          const allFileIds = [...new Set([...fileNodeIds, ...pageSourceFileIds, ...embeddedImageIds])]
          if (allFileIds.length) {
            void import('@/lib/storage/manager').then(({ deleteFiles }) => deleteFiles(allFileIds))
          }

          // Evict page content from memory + archive + cloud index.
          contentIds.forEach((cid) => docStore.forgetPage(cid))
        })
        // ───────────────────────────────────────────────────────────────────

        // xlsx content lives outside useDocStore (see file-page-content.ts) —
        // clean it up here too, same as contentIds above does for scene-object pages.
        void import('@/lib/store/file-page-content').then(({ useFilePageContentStore }) =>
          pageNodes.forEach((p) => useFilePageContentStore.getState().forgetContent(p.id))
        )
        const deleteSet = new Set(toDelete.map((n) => n.id))
        set((s) => {
          const nextNodes = { ...s.nodes }
          deleteSet.forEach((did) => delete nextNodes[did])
          const nextPanes = s.panes.filter((p) => !deleteSet.has(p))
          const nextActivePaneIndex = Math.min(s.activePaneIndex, Math.max(0, nextPanes.length - 1))
          return {
            nodes: nextNodes,
            openTabs: s.openTabs.filter((t) => !deleteSet.has(t)),
            panes: nextPanes,
            activePaneIndex: nextActivePaneIndex,
            ...panesAliases(nextPanes, nextActivePaneIndex),
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

      addPageIn: (parentId, name = 'Untitled Page', kind = 'board', activate = true) => {
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
          if (!activate) return { nodes: { ...s.nodes, [id]: node } }
          const openTabs = s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id]
          // New page always opens as the sole focused pane (replaces active slot).
          const panes = s.panes.length === 0 ? [id] : s.panes.map((p, i) => i === s.activePaneIndex ? id : p)
          const activePaneIndex = s.activePaneIndex
          return {
            nodes: { ...s.nodes, [id]: node },
            openTabs,
            panes,
            activePaneIndex,
            ...panesAliases(panes, activePaneIndex),
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
          if (!id) return { activePageId: null, openTabs }
          // If the page is already in a pane, focus that pane.
          const existingPaneIdx = s.panes.indexOf(id)
          if (existingPaneIdx !== -1) {
            return { activePaneIndex: existingPaneIdx, openTabs,
              ...panesAliases(s.panes, existingPaneIdx) }
          }
          // Otherwise replace the currently focused pane's page.
          const panes = s.panes.length === 0
            ? [id]
            : s.panes.map((p, i) => i === s.activePaneIndex ? id : p)
          const activePaneIndex = s.activePaneIndex
          return { openTabs, panes, activePaneIndex, ...panesAliases(panes, activePaneIndex) }
        }),

      closeTab: (id) =>
        set((s) => {
          const openTabs = s.openTabs.filter((t) => t !== id)
          const fallback = openTabs[openTabs.length - 1] ?? null
          const nextPanes = s.panes.filter((p) => p !== id)
          const nextActivePaneIndex = Math.min(s.activePaneIndex, Math.max(0, nextPanes.length - 1))
          // If no panes left but fallback tab exists, show it.
          const finalPanes = nextPanes.length === 0 && fallback ? [fallback] : nextPanes
          const finalActiveIdx = nextPanes.length === 0 && fallback ? 0 : nextActivePaneIndex
          return {
            openTabs,
            panes: finalPanes,
            activePaneIndex: finalActiveIdx,
            ...panesAliases(finalPanes, finalActiveIdx),
          }
        }),

      addPane: (id) =>
        set((s) => {
          if (s.panes.length >= 4) return s
          const openTabs = s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id]
          // Don't add a duplicate — just focus it.
          if (s.panes.includes(id)) {
            const idx = s.panes.indexOf(id)
            return { openTabs, activePaneIndex: idx,
              ...panesAliases(s.panes, idx) }
          }
          const panes = dedupePanes([...s.panes, id])
          const activePaneIndex = panes.length - 1
          return { openTabs, panes, activePaneIndex, ...panesAliases(panes, activePaneIndex) }
        }),

      removePane: (index) =>
        set((s) => {
          if (s.panes.length <= 1) return s
          const nextPanes = s.panes.filter((_, i) => i !== index)
          const nextActivePaneIndex = Math.min(s.activePaneIndex, nextPanes.length - 1)
          return { panes: nextPanes, activePaneIndex: nextActivePaneIndex,
            ...panesAliases(nextPanes, nextActivePaneIndex) }
        }),

      setActivePane: (index) =>
        set((s) => {
          const clamped = Math.max(0, Math.min(index, s.panes.length - 1))
          return { activePaneIndex: clamped, ...panesAliases(s.panes, clamped) }
        }),

      movePaneTo: (fromIndex, toIndex) =>
        set((s) => {
          if (fromIndex === toIndex) return s
          const next = [...s.panes]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          const activePaneIndex = toIndex
          return { panes: next, activePaneIndex, ...panesAliases(next, activePaneIndex) }
        }),

      // ── Legacy compat wrappers ──────────────────────────────────────────
      openSplit: (id) => get().addPane(id),

      dropTab: (id, side) =>
        set((s) => {
          const openTabs = s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id]
          if (s.panes.length <= 1) {
            // Currently single pane — split into left/right.
            const current = s.panes[0] ?? null
            if (!current || current === id) {
              const panes = [id]
              return { openTabs, panes, activePaneIndex: 0, ...panesAliases(panes, 0) }
            }
            const panes = side === 'right' ? [current, id] : [id, current]
            const activePaneIndex = side === 'right' ? 1 : 0
            return { openTabs, panes, activePaneIndex, ...panesAliases(panes, activePaneIndex) }
          }
          // Already split: move/add to target slot.
          if (s.panes.includes(id)) {
            const idx = s.panes.indexOf(id)
            const target = side === 'right' ? Math.min(s.panes.length - 1, 1) : 0
            if (idx === target) return { openTabs, activePaneIndex: idx,
              ...panesAliases(s.panes, idx) }
            const next = [...s.panes]
            const [moved] = next.splice(idx, 1)
            next.splice(target, 0, moved)
            return { openTabs, panes: next, activePaneIndex: target, ...panesAliases(next, target) }
          }
          const target = side === 'right' ? Math.min(s.panes.length, 1) : 0
          const next = [...s.panes]
          next.splice(target, 0, id)
          const panes = dedupePanes(next)
          return { openTabs, panes, activePaneIndex: target, ...panesAliases(panes, target) }
        }),

      closeSplit: (keep?) =>
        set((s) => {
          if (s.panes.length <= 1) return s
          const keepIdx = keep === 'split' ? 1 : 0
          const id = s.panes[keepIdx] ?? s.panes[0]
          const panes = [id]
          return { panes, activePaneIndex: 0, ...panesAliases(panes, 0) }
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
      // Strip heavy web-cache blobs before persisting — webCachedHtml can be
      // 100s of KB per page, and with many web pages open the workspace key
      // blows past localStorage's 5 MB quota. The reader-mode cache is just
      // a convenience that can be re-fetched; stripping it never loses work.
      partialize: (state) => ({
        ...state,
        nodes: Object.fromEntries(
          Object.entries(state.nodes).map(([id, node]) => {
            if (node.kind !== 'page') return [id, node]
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { webCachedHtml: _html, webCachedText: _text, webHistory: _hist, ...rest } = node as PageNode & {
              webCachedHtml?: unknown
              webCachedText?: unknown
              webHistory?: unknown
            }
            return [id, rest]
          })
        ),
      }),
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
        // Rehydrate: if panes is missing/empty but primaryPageId exists,
        // reconstruct panes from the legacy two-slot model.
        if (!state.panes || state.panes.length === 0) {
          const primary = state.primaryPageId
          const split = state.splitPageId
          if (primary && split && primary !== split) state.panes = [primary, split]
          else if (primary) state.panes = [primary]
          else if (state.activePageId) state.panes = [state.activePageId]
          state.activePaneIndex = 0
        }
      },
    }
  )
)
