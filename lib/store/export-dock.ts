'use client'

// What the current page can be exported as. Written by the page's view (doc,
// PDF, slides, spreadsheet), read by the ONE shared ExportButton in the tab
// bar — same published-then-rendered shape as doc-dock / pdf-dock. Boards
// don't publish: their export panel is rendered by ExportButton itself.

import { create } from 'zustand'

export interface ExportItem {
  id: string
  label: string
  hint?: string
  busy?: boolean
  run: () => void
}

interface ExportDockStore {
  items: ExportItem[] | null
  set: (items: ExportItem[] | null) => void
}

export const useExportDock = create<ExportDockStore>((set) => ({
  items: null,
  set: (items) => set({ items }),
}))
