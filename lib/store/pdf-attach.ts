'use client'

// The canonical "give a PDF-kind page a file" sequence — shared by
// pdf-view.tsx's own upload/drop and the add-page dialog's PDF step (see
// components/workspace/add-page-dialog.tsx), so both end up with the same
// fileName/fileMime bookkeeping and thumbnail invalidation instead of two
// hand-copied versions drifting apart.

import { putSessionFile, type SessionFile } from '@/lib/store/session-files'
import { convertToPdf } from '@/lib/store/to-pdf'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'

/** Convert to PDF if needed, store it locally, invalidate the cached
 *  thumbnail, record the real file name, and rename the page off
 *  "Untitled…" once a real name is known. Throws on a failed conversion —
 *  callers decide how to surface that (toast, inline error, …). */
export async function attachPdfToPage(
  pageId: string,
  file: File,
  onProgress?: (message: string | null) => void
): Promise<SessionFile> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  let toStore = file
  if (!(file.type === 'application/pdf' || ext === '.pdf')) {
    onProgress?.('Converting to PDF…')
    try {
      toStore = await convertToPdf(file, (done, total) => onProgress?.(`Converting to PDF… ${done}/${total}`))
    } finally {
      onProgress?.(null)
    }
  }
  const stored = putSessionFile(pageId, toStore)
  const { invalidatePdfThumb } = await import('@/lib/store/pdf-thumb')
  invalidatePdfThumb(pageId)
  useWorkspaceStore.getState().updatePageMeta(pageId, { fileName: file.name, fileMime: 'application/pdf' })
  const meta = findPageMeta(useWorkspaceStore.getState().notebooks, pageId)
  if (meta?.name.startsWith('Untitled'))
    useWorkspaceStore.getState().renamePage(pageId, file.name.replace(/\.[^.]+$/, ''))
  return stored
}
