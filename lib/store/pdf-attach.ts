'use client'

// The canonical "give a PDF-kind page a file" sequence — shared by
// pdf-view.tsx's own upload/drop and the add-page dialog's PDF step (see
// components/workspace/add-page-dialog.tsx), so both end up with the same
// fileName/fileMime bookkeeping and thumbnail invalidation instead of two
// hand-copied versions drifting apart.
//
// Storage: OPFS + manifest (lib/storage/manager.ts), not the old
// session-files.ts IndexedDB cache — that module is now scoped to
// session-only canvas embeds only (components/objects/file-view.tsx), a
// genuinely different, non-durable storage lifetime. A pdf-kind page's file
// is durable workspace data and belongs in the same system every other
// uploaded file goes through.

import { convertToPdf } from '@/lib/store/to-pdf'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useAuthStore } from '@/lib/auth/store'
import { putFile } from '@/lib/storage/manager'

export interface AttachedFile {
  /** Blob URL, ready to hand to pdf.js or an <a href>. Caller owns revoking
   *  it once done (same convention SessionFile.url used). */
  url: string
  name: string
  mime: string
  /** Manifest id — resolves the durable copy via lib/storage/manager's
   *  getFile, independent of this blob URL's lifetime. */
  fileId: string
}

/** Convert to PDF if needed, store it durably, invalidate the cached
 *  thumbnail, record the real file name, and rename the page off
 *  "Untitled…" once a real name is known. Throws on a failed conversion —
 *  callers decide how to surface that (toast, inline error, …). */
export async function attachPdfToPage(
  pageId: string,
  file: File,
  onProgress?: (message: string | null) => void
): Promise<AttachedFile> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  let toStore: File | Blob = file
  if (!(file.type === 'application/pdf' || ext === '.pdf')) {
    onProgress?.('Converting to PDF…')
    try {
      toStore = await convertToPdf(file, (done, total) => onProgress?.(`Converting to PDF… ${done}/${total}`))
    } finally {
      onProgress?.(null)
    }
  }
  const ownerId = useAuthStore.getState().profile?.id ?? 'anon'
  const fileId = await putFile(toStore, file.name, 'application/pdf', ownerId)
  const stored: AttachedFile = { url: URL.createObjectURL(toStore), name: file.name, mime: 'application/pdf', fileId }
  const { invalidatePdfThumb } = await import('@/lib/store/pdf-thumb')
  invalidatePdfThumb(pageId)
  useWorkspaceStore
    .getState()
    .updatePageMeta(pageId, { fileName: file.name, fileMime: 'application/pdf', fileUrl: `opfs:${fileId}` })
  const meta = findPageMeta(useWorkspaceStore.getState().nodes, pageId)
  if (meta?.name.startsWith('Untitled'))
    useWorkspaceStore.getState().renameNode(pageId, file.name.replace(/\.[^.]+$/, ''))
  return stored
}
