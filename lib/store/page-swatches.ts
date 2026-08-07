'use client'

// Custom background colors added via a text object's "+" swatch, shared
// across every text box on the same content page (a board page's own id,
// or a doc/pptx sheet's content id) — not the notebook-tree PageNode, since
// a slide's content id has no reverse lookup back to its owning tree node
// worth building for this. Session-only, same as the pen tool's own
// customColors' spirit (device/session convenience, not page content) —
// capped at 12 per page.

import { create } from 'zustand'

// A stable empty-array reference for pages with no swatches yet — a fresh
// `[]` literal returned from a selector on every call breaks
// useSyncExternalStore's reference-equality check (getSnapshot must return
// the same reference when nothing changed), which React surfaces as an
// infinite-loop error. Exported so callers' selectors can fall back to this
// SAME reference instead of writing their own `?? []`.
export const EMPTY_SWATCHES: string[] = []

interface PageSwatchesStore {
  swatches: Record<string, string[]>
  add: (pageId: string, hex: string) => void
}

export const usePageSwatches = create<PageSwatchesStore>((set, get) => ({
  swatches: {},
  add: (pageId, hex) => {
    const existing = get().swatches[pageId] ?? []
    if (existing.includes(hex)) return
    set({ swatches: { ...get().swatches, [pageId]: [...existing, hex].slice(-12) } })
  },
}))
