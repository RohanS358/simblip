'use client'

// Published by DocView, read by PageControlsMenu — same "written by one,
// read by another" shape as usePdfDockStore (lib/store/pdf-dock.ts). The
// doc page kind's Export PDF button and zoom strip used to float over the
// canvas (see git history on doc-view.tsx); they now live in the tab bar's
// controls row instead.

import { create } from 'zustand'

export interface DocDockState {
  zoom: number
  exporting: boolean
  exportingDocx: boolean
  setZoom: (zoom: number) => void
  /** Zoom so the page's full width (or height) fills the viewport. */
  fitWidth: () => void
  fitHeight: () => void
  exportPdf: () => void
  exportDocx: () => void
  sorterOpen: boolean
  toggleSorter: () => void
}

interface DocDockStore {
  dock: DocDockState | null
  set: (dock: DocDockState | null) => void
}

export const useDocDockStore = create<DocDockStore>((set) => ({
  dock: null,
  set: (dock) => set({ dock }),
}))
