'use client'

// Published by PdfView, read by PageControlsMenu — the PDF reader's page
// nav/notes/zoom controls used to float their own pill over the canvas
// (see git history on pdf-view.tsx); they now live in the tab bar's controls
// menu instead, so PdfView just hands its live state and actions over here
// rather than owning any dock chrome itself. Same "written by one, read by
// another" shape as useDockRect in hooks/use-dock-clearance.ts.

import { create } from 'zustand'

export interface PdfDockState {
  current: number
  numPages: number
  notesOpen: boolean
  linked: boolean
  zoom: number
  toggleNotes: () => void
  toggleLink: () => void
  setZoom: (zoom: number) => void
  /** Zoom so the page's full width (or height) fills the reader pane. */
  fitWidth: () => void
  fitHeight: () => void
  download: () => void
  replace: () => void
  scrollToPage?: (pageNum: number) => void
}

interface PdfDockStore {
  dock: PdfDockState | null
  set: (dock: PdfDockState | null) => void
}

export const usePdfDockStore = create<PdfDockStore>((set) => ({
  dock: null,
  set: (dock) => set({ dock }),
}))
