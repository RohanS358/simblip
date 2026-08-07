'use client'

// Published by PresentationView, read by PageControlsMenu — same "written
// by one, read by another" shape as useDocDockStore/usePdfDockStore. Slide
// controls (Present/Export/New slide) live in the tab bar's controls row
// instead of PresentationView's own inline toolbar, matching how the doc
// and PDF page kinds already publish theirs there.

import { create } from 'zustand'

export type SlideTransition = 'none' | 'fade' | 'slide'

export interface PresentationDockState {
  current: number
  numSlides: number
  exporting: boolean
  importing: boolean
  zoom: number
  setZoom: (zoom: number) => void
  /** Zoom so the slide's full width fills the available viewport. */
  fitWidth: () => void
  transition: SlideTransition
  setTransition: (t: SlideTransition) => void
  present: () => void
  exportPptx: () => void
  addSlide: () => void
}

interface PresentationDockStore {
  dock: PresentationDockState | null
  set: (dock: PresentationDockState | null) => void
}

export const usePresentationDockStore = create<PresentationDockStore>((set) => ({
  dock: null,
  set: (dock) => set({ dock }),
}))
