'use client'

// Workspace tree: notebooks → sections → pages (metadata only).
// Content lives in the document store; splitting them keeps tree operations
// cheap and gives undo/redo a clean per-page scope.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uid, type Notebook, type PageKind, type PageMeta } from '@/lib/scene/types'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'

interface WorkspaceState {
  notebooks: Notebook[]
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

  addNotebook: (name?: string) => string
  renameNotebook: (id: string, name: string) => void
  setNotebookCover: (id: string, cover: string | undefined) => void
  removeNotebook: (id: string) => void
  addSection: (notebookId: string, name?: string) => string
  renameSection: (notebookId: string, id: string, name: string) => void
  removeSection: (notebookId: string, id: string) => void
  addPage: (notebookId: string, sectionId: string, name?: string, kind?: PageKind) => string
  renamePage: (pageId: string, name: string) => void
  removePage: (pageId: string) => void
  updatePageMeta: (pageId: string, patch: Partial<Omit<PageMeta, 'id'>>) => void
  /** Append a fresh sheet to a doc page; returns its content-page id. */
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

/** Find a page's metadata anywhere in the tree. */
export function findPageMeta(notebooks: Notebook[], pageId: string | null): PageMeta | null {
  if (!pageId) return null
  for (const nb of notebooks)
    for (const sec of nb.sections)
      for (const p of sec.pages) if (p.id === pageId) return p
  return null
}

/** Which notebook owns a page — same walk as findPageMeta, returns the id. */
export function findNotebookId(notebooks: Notebook[], pageId: string | null): string | null {
  if (!pageId) return null
  for (const nb of notebooks)
    for (const sec of nb.sections)
      for (const p of sec.pages) if (p.id === pageId) return nb.id
  return null
}

const patchPage = (notebooks: Notebook[], pageId: string, patch: Partial<PageMeta>): Notebook[] =>
  notebooks.map((n) => ({
    ...n,
    sections: n.sections.map((sec) => ({
      ...sec,
      pages: sec.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
    })),
  }))

const SECTION_COLORS = ['blue', 'mint', 'amber', 'violet', 'rose']

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      notebooks: [],
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

      addNotebook: (name = 'Untitled Notebook') => {
        const id = uid()
        set((s) => ({
          notebooks: [...s.notebooks, { id, name, emoji: '📓', sections: [] }],
        }))
        return id
      },

      renameNotebook: (id, name) =>
        set((s) => ({
          notebooks: s.notebooks.map((n) => (n.id === id ? { ...n, name } : n)),
        })),

      setNotebookCover: (id, cover) =>
        set((s) => ({
          notebooks: s.notebooks.map((n) => (n.id === id ? { ...n, cover } : n)),
        })),

      removeNotebook: (id) =>
        set((s) => {
          const nb = s.notebooks.find((n) => n.id === id)
          const pageIds = nb?.sections.flatMap((sec) => sec.pages.map((p) => p.id)) ?? []
          return {
            notebooks: s.notebooks.filter((n) => n.id !== id),
            activePageId: pageIds.includes(s.activePageId ?? '') ? null : s.activePageId,
          }
        }),

      addSection: (notebookId, name = 'New Section') => {
        const id = uid()
        set((s) => ({
          notebooks: s.notebooks.map((n) =>
            n.id === notebookId
              ? {
                  ...n,
                  sections: [
                    ...n.sections,
                    { id, name, color: SECTION_COLORS[n.sections.length % SECTION_COLORS.length], pages: [] },
                  ],
                }
              : n
          ),
        }))
        return id
      },

      renameSection: (notebookId, id, name) =>
        set((s) => ({
          notebooks: s.notebooks.map((n) =>
            n.id === notebookId
              ? { ...n, sections: n.sections.map((sec) => (sec.id === id ? { ...sec, name } : sec)) }
              : n
          ),
        })),

      removeSection: (notebookId, id) =>
        set((s) => {
          const nb = s.notebooks.find((n) => n.id === notebookId)
          const pageIds = nb?.sections.find((sec) => sec.id === id)?.pages.map((p) => p.id) ?? []
          return {
            notebooks: s.notebooks.map((n) =>
              n.id === notebookId ? { ...n, sections: n.sections.filter((sec) => sec.id !== id) } : n
            ),
            activePageId: pageIds.includes(s.activePageId ?? '') ? null : s.activePageId,
          }
        }),

      addPage: (notebookId, sectionId, name = 'Untitled Page', kind = 'board') => {
        const id = uid()
        // A doc starts with one sheet; a board/pdf carries its own content.
        const meta: PageMeta = { id, name, kind, ...(kind === 'doc' ? { docPages: [uid()] } : {}) }
        set((s) => ({
          notebooks: s.notebooks.map((n) =>
            n.id === notebookId
              ? {
                  ...n,
                  sections: n.sections.map((sec) =>
                    sec.id === sectionId ? { ...sec, pages: [...sec.pages, meta] } : sec
                  ),
                }
              : n
          ),
          activePageId: id,
          openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
        }))
        return id
      },

      renamePage: (pageId, name) =>
        set((s) => ({
          notebooks: s.notebooks.map((n) => ({
            ...n,
            sections: n.sections.map((sec) => ({
              ...sec,
              pages: sec.pages.map((p) => (p.id === pageId ? { ...p, name } : p)),
            })),
          })),
        })),

      removePage: (pageId) => {
        // Deleting a page is the ONE case where content should really go —
        // forgetPage drops it from memory, from the local archive, and
        // queues the cloud deletion. (Merely closing a page must never do
        // this; see lib/store/deleted-pages.ts.) Docs/PDFs also own their
        // sheets and per-page notes — those go with them.
        const meta = findPageMeta(get().notebooks, pageId)
        const contentIds = [pageId, ...(meta?.docPages ?? []), ...(meta?.notesPages ?? []).filter(Boolean)]
        void import('@/lib/store/document').then(({ useDocStore }) =>
          contentIds.forEach((id) => useDocStore.getState().forgetPage(id))
        )
        set((s) => ({
          notebooks: s.notebooks.map((n) => ({
            ...n,
            sections: n.sections.map((sec) => ({
              ...sec,
              pages: sec.pages.filter((p) => p.id !== pageId),
            })),
          })),
          activePageId: s.activePageId === pageId ? null : s.activePageId,
          openTabs: s.openTabs.filter((t) => t !== pageId),
          splitPageId: s.splitPageId === pageId ? null : s.splitPageId,
          primaryPageId: s.primaryPageId === pageId ? null : s.primaryPageId,
        }))
      },

      updatePageMeta: (pageId, patch) =>
        set((s) => ({ notebooks: patchPage(s.notebooks, pageId, patch) })),

      addDocSheet: (pageId) => {
        const sheetId = uid()
        set((s) => {
          const meta = findPageMeta(s.notebooks, pageId)
          return {
            notebooks: patchPage(s.notebooks, pageId, {
              docPages: [...(meta?.docPages ?? []), sheetId],
            }),
          }
        })
        return sheetId
      },

      ensureNotesPage: (pageId, pdfPage) => {
        const meta = findPageMeta(get().notebooks, pageId)
        const existing = meta?.notesPages?.[pdfPage - 1]
        if (existing) return existing
        const noteId = uid()
        set((s) => {
          const m = findPageMeta(s.notebooks, pageId)
          const notes = [...(m?.notesPages ?? [])]
          while (notes.length < pdfPage) notes.push('')
          notes[pdfPage - 1] = noteId
          return { notebooks: patchPage(s.notebooks, pageId, { notesPages: notes }) }
        })
        return noteId
      },

      ensureAnnotPage: (pageId, pdfPage) => {
        const meta = findPageMeta(get().notebooks, pageId)
        const existing = meta?.annotPages?.[pdfPage - 1]
        if (existing) return existing
        const annotId = uid()
        set((s) => {
          const m = findPageMeta(s.notebooks, pageId)
          const annots = [...(m?.annotPages ?? [])]
          while (annots.length < pdfPage) annots.push('')
          annots[pdfPage - 1] = annotId
          return { notebooks: patchPage(s.notebooks, pageId, { annotPages: annots }) }
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
    { name: 'simblip-workspace', storage: scopedJSONStorage }
  )
)
