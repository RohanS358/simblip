'use client'

// Content store for xlsx pages, whose content isn't scene-object data
// (lib/store/document.ts's objects/variables shape) — a spreadsheet grid
// JSON blob instead. Every other page kind fits useDocStore's PageContent
// (doc/pptx sheets are scene-object pages; image's content IS its ink
// overlay, a real board page via imageAnnotPageId), so this store stays
// scoped to xlsx alone rather than growing into a general "everything else"
// bucket.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'

interface FilePageContentState {
  /** pageId -> spreadsheet grid JSON (x-data-spreadsheet's own format). */
  content: Record<string, unknown>
  setContent: (pageId: string, value: unknown) => void
  getContent: (pageId: string) => unknown
  forgetContent: (pageId: string) => void
}

export const useFilePageContentStore = create<FilePageContentState>()(
  persist(
    (set, get) => ({
      content: {},
      setContent: (pageId, value) => set((s) => ({ content: { ...s.content, [pageId]: value } })),
      getContent: (pageId) => get().content[pageId],
      forgetContent: (pageId) =>
        set((s) => {
          const next = { ...s.content }
          delete next[pageId]
          return { content: next }
        }),
    }),
    { name: 'simblip-file-page-content', storage: scopedJSONStorage }
  )
)
