'use client'

// Read an open PDF page by page, so a tour can turn the reader to each page and teach what is on it. Text only: a scanned
// page has no text layer and is reported as such, not guessed at.

import { findPageMeta, useWorkspaceStore } from '@/lib/store/workspace'
import { getFile } from '@/lib/storage/manager'
import type { PageItem } from './page-read'

const MAX_PAGES = 40
const MAX_CHARS = 1800

export async function readPdf(pageId: string): Promise<PageItem[]> {
  const meta = findPageMeta(useWorkspaceStore.getState().nodes, pageId)
  const url = meta?.fileUrl
  if (!url) return []
  const blob = url.startsWith('opfs:') ? await getFile(url.slice('opfs:'.length)) : await fetch(url).then((r) => (r.ok ? r.blob() : null)).catch(() => null)
  if (!blob) return []
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
  const items: PageItem[] = []
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ').trim()
    // A page that is a picture of text reads as nothing: say so rather than skip it silently.
    items.push({ kind: 'text', ids: [], pageId, pdfPage: n, text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text || `Page ${n} has no selectable text — it is probably a scanned image.` })
  }
  return items
}
