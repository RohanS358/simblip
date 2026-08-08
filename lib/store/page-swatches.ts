'use client'

// Custom colors added via any "+" color picker (text fill, selection color,
// page background, …) — shared across the WHOLE document (every sheet/slide
// of a doc/pptx, not just the one it was added on), keyed by the owning
// PageNode id (see workspace.ts's ownerPageOf). Persisted like the pen
// tool's own customColors — pick a brand color once, it's there next
// session too. Capped at 12 per document.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// A stable empty-array reference for documents with no swatches yet — a
// fresh `[]` literal returned from a selector on every call breaks
// useSyncExternalStore's reference-equality check (getSnapshot must return
// the same reference when nothing changed), which React surfaces as an
// infinite-loop error. Exported so callers' selectors can fall back to this
// SAME reference instead of writing their own `?? []`.
export const EMPTY_SWATCHES: string[] = []

interface PageSwatchesStore {
  swatches: Record<string, string[]>
  add: (documentId: string, hex: string) => void
}

export const usePageSwatches = create<PageSwatchesStore>()(
  persist(
    (set, get) => ({
      swatches: {},
      add: (documentId, hex) => {
        const existing = get().swatches[documentId] ?? []
        if (existing.includes(hex)) return
        set({ swatches: { ...get().swatches, [documentId]: [...existing, hex].slice(-12) } })
      },
    }),
    { name: 'simblip-page-swatches' }
  )
)
