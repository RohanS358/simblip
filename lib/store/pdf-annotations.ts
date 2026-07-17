'use client'

// Pen annotations for PDF/PPT reader pages. Strokes are stored in PDF-page
// coordinates normalized to the page width (so they stay glued to the content
// at any render size), keyed per notebook-page and per PDF page number.
// Deliberately NOT SceneObjects: a reader page has no simulation, and a flat
// polyline list keeps the storage tiny.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'

export interface PdfStroke {
  /** flat [x0,y0,x1,y1,…] in units of pageWidth (0..1 across, y same scale) */
  pts: number[]
  color: string
  /** width in units of pageWidth */
  size: number
  /** highlighter renders translucent under the text */
  hl?: boolean
}

interface AnnotState {
  /** pageId → pdfPageNo → strokes */
  strokes: Record<string, Record<number, PdfStroke[]>>
  addStroke: (pageId: string, pdfPage: number, stroke: PdfStroke) => void
  undoStroke: (pageId: string, pdfPage: number) => void
  eraseAt: (pageId: string, pdfPage: number, x: number, y: number, r: number) => void
  clearPage: (pageId: string, pdfPage: number) => void
  dropDocument: (pageId: string) => void
}

export const usePdfAnnotations = create<AnnotState>()(
  persist(
    (set) => ({
      strokes: {},

      addStroke: (pageId, pdfPage, stroke) =>
        set((s) => {
          const doc = s.strokes[pageId] ?? {}
          return {
            strokes: {
              ...s.strokes,
              [pageId]: { ...doc, [pdfPage]: [...(doc[pdfPage] ?? []), stroke] },
            },
          }
        }),

      undoStroke: (pageId, pdfPage) =>
        set((s) => {
          const doc = s.strokes[pageId]
          const list = doc?.[pdfPage]
          if (!list?.length) return {}
          return {
            strokes: { ...s.strokes, [pageId]: { ...doc, [pdfPage]: list.slice(0, -1) } },
          }
        }),

      eraseAt: (pageId, pdfPage, x, y, r) =>
        set((s) => {
          const doc = s.strokes[pageId]
          const list = doc?.[pdfPage]
          if (!list?.length) return {}
          const keep = list.filter((st) => {
            for (let i = 0; i < st.pts.length; i += 2)
              if (Math.hypot(st.pts[i] - x, st.pts[i + 1] - y) < r) return false
            return true
          })
          if (keep.length === list.length) return {}
          return { strokes: { ...s.strokes, [pageId]: { ...doc, [pdfPage]: keep } } }
        }),

      clearPage: (pageId, pdfPage) =>
        set((s) => {
          const doc = s.strokes[pageId]
          if (!doc?.[pdfPage]?.length) return {}
          return { strokes: { ...s.strokes, [pageId]: { ...doc, [pdfPage]: [] } } }
        }),

      dropDocument: (pageId) =>
        set((s) => {
          if (!s.strokes[pageId]) return {}
          const next = { ...s.strokes }
          delete next[pageId]
          return { strokes: next }
        }),
    }),
    { name: 'simblip-pdf-annotations', storage: scopedJSONStorage }
  )
)
