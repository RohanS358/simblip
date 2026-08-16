'use client'

// Presentation controls (zoom/transition/present/export/new-slide) now live
// in their own bar inside presentation-view.tsx, below the slide rail —
// full labels, not a shared tab-bar dock like doc/pdf use, since that page
// kind has enough controls to want a dedicated bar. Only the shared
// transition type survives here for page-controls-menu.tsx-adjacent code
// that still needs it.

import { create } from 'zustand'

export type SlideTransition = 'none' | 'fade' | 'slide'

export interface PresentationDockState {
  tocOpen: boolean
  toggleToc: () => void
  hasToc: boolean
  goToSlide?: (index: number) => void
}

interface PresentationDockStore {
  dock: PresentationDockState | null
  set: (dock: PresentationDockState | null) => void
}

export const usePresentationDockStore = create<PresentationDockStore>((set) => ({
  dock: null,
  set: (dock) => set({ dock }),
}))
