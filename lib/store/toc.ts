'use client'

// The document outline, published by whichever view can produce one (the PDF
// reader's embedded outline, the presentation's slide headings) and read by
// the left rail's "Contents" section.
//
// It used to be a side rail each view drew INSIDE itself, which meant two
// copies of the same list, its own open/closed state per view, and a second
// column competing with the sidebar for the left edge. Now it is a sidebar
// section like any other: one panel system, one home — the same move
// Properties made when the right-side Inspector dock retired (see
// lib/store/sidebar-sections.ts).
//
// `index` is deliberately opaque: a page number to the PDF reader, a slide
// index to the presentation. Only the publisher interprets it — the panel
// just hands it back to `goTo`.

import { create } from 'zustand'

export interface TocEntry {
  index: number
  title: string
  level: number
  /** Right-aligned locator, e.g. "p.4" or "s.12". Publisher's wording. */
  locator?: string
}

export interface TocSource {
  entries: TocEntry[]
  /** Which entry index is currently in view, for the selected highlight. */
  current: number
  goTo: (index: number) => void
}

export const useTocStore = create<{
  toc: TocSource | null
  set: (toc: TocSource | null) => void
}>((set) => ({
  toc: null,
  set: (toc) => set({ toc }),
}))
