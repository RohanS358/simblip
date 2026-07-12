'use client'

// Workspace tree: notebooks → sections → pages (metadata only).
// Content lives in the document store; splitting them keeps tree operations
// cheap and gives undo/redo a clean per-page scope.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uid, type Notebook } from '@/lib/scene/types'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'

interface WorkspaceState {
  notebooks: Notebook[]
  activePageId: string | null
  sidebarOpen: boolean
  inspectorOpen: boolean
  aiOpen: boolean

  addNotebook: (name?: string) => string
  renameNotebook: (id: string, name: string) => void
  removeNotebook: (id: string) => void
  addSection: (notebookId: string, name?: string) => string
  renameSection: (notebookId: string, id: string, name: string) => void
  removeSection: (notebookId: string, id: string) => void
  addPage: (notebookId: string, sectionId: string, name?: string) => string
  renamePage: (pageId: string, name: string) => void
  removePage: (pageId: string) => void
  setActivePage: (id: string | null) => void
  togglePanel: (panel: 'sidebar' | 'inspector' | 'ai') => void
}

const SECTION_COLORS = ['blue', 'mint', 'amber', 'violet', 'rose']

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      notebooks: [],
      activePageId: null,
      sidebarOpen: true,
      inspectorOpen: true,
      aiOpen: false,

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

      addPage: (notebookId, sectionId, name = 'Untitled Page') => {
        const id = uid()
        set((s) => ({
          notebooks: s.notebooks.map((n) =>
            n.id === notebookId
              ? {
                  ...n,
                  sections: n.sections.map((sec) =>
                    sec.id === sectionId ? { ...sec, pages: [...sec.pages, { id, name }] } : sec
                  ),
                }
              : n
          ),
          activePageId: id,
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
        // this; see lib/store/deleted-pages.ts.)
        void import('@/lib/store/document').then(({ useDocStore }) =>
          useDocStore.getState().forgetPage(pageId)
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
        }))
      },

      setActivePage: (id) => set({ activePageId: id }),

      togglePanel: (panel) =>
        set((s) =>
          panel === 'sidebar'
            ? { sidebarOpen: !s.sidebarOpen }
            : panel === 'inspector'
              ? { inspectorOpen: !s.inspectorOpen }
              : { aiOpen: !s.aiOpen }
        ),
    }),
    { name: 'simblip-workspace', storage: scopedJSONStorage }
  )
)
