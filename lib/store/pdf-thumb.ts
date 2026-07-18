'use client'

// First-page PDF thumbnails for the notebook card grid. Rendered once per
// page id from the locally cached document (IndexedDB), memoized for the
// session — cards never trigger network fetches or repeat rasterization.

import { loadSessionFile } from '@/lib/store/session-files'

const cache = new Map<string, Promise<string | null>>()

export function pdfThumb(pageId: string): Promise<string | null> {
  let p = cache.get(pageId)
  if (!p) {
    p = render(pageId).catch(() => null)
    cache.set(pageId, p)
  }
  return p
}

/** A replaced/newly attached file should re-render on next request. */
export function invalidatePdfThumb(pageId: string): void {
  cache.delete(pageId)
}

async function render(pageId: string): Promise<string | null> {
  const file = await loadSessionFile(pageId)
  if (!file) return null
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()
  const doc = await pdfjs.getDocument({ url: file.url }).promise
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = 220 / base.width
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(vp.width)
  canvas.height = Math.ceil(vp.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
  return canvas.toDataURL('image/jpeg', 0.8)
}
