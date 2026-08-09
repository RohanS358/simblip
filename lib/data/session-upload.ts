'use client'

// Presentation file sharing. When a teacher presents a page that carries
// session documents, the files are pushed somewhere the board (and class
// followers) can reach:
//
//   cloud — the /api/files route (Postgres-backed) under
//           <sessionId>/<objectId or 'page'>. Deleted when the teacher
//           resolves the presentation, with a 3-hour server sweep as the
//           safety net.
//   local — a demo-db table of data URLs (same-browser tabs).
//
// Two different kinds of file reference get rewritten to a shareable URL:
//   1. File-object elements (metadata.render === 'file') — bytes live in
//      the session-file ephemeral cache (lib/store/ephemeral-storage.ts).
//   2. The page ITSELF, for pdf/image/xlsx/pptx-kind pages — bytes live in
//      OPFS via lib/storage/manager.ts, referenced as bundle.fileUrl =
//      'opfs:<fileId>'. Without this, a presented PDF/image/xlsx/pptx page
//      keeps an opfs: reference that only resolves on the teacher's own
//      device — the board (a different device/origin) can never read it.

import * as db from './db'
import { getAccessToken } from '@/lib/auth/store'
import { getSessionBlob, loadSessionFile } from '@/lib/store/ephemeral-storage'
import type { PageDoc } from '@/lib/scene/types'
import type { PageBundle } from '@/lib/store/page-bundle'

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(blob)
  })

/** Upload one blob to the session's shareable storage, cloud or local
 *  depending on db.dbMode. Returns the shareable URL. */
async function shareBlob(sessionId: string, key: string, blob: Blob, mime: string): Promise<string> {
  if (db.dbMode === 'cloud') {
    const path = `${sessionId}/${key}`
    const res = await fetch(`/api/files/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getAccessToken() ?? ''}`,
        'Content-Type': mime || 'application/octet-stream',
      },
      body: blob,
    })
    if (!res.ok) throw new Error(await res.text())
    return `/api/files/${path}`
  }
  const data = await blobToDataUrl(blob)
  await db.insert('session_files', { id: `${sessionId}/${key}`, data })
  return `local:${sessionId}/${key}`
}

/** Upload every attached session document referenced by the snapshot — both
 *  file-object elements and (if this is a pdf/image/xlsx/pptx-kind page
 *  bundle) the page's own source file — and stamp shareable URLs so the
 *  board can render it. Returns the enriched snapshot. */
export async function uploadSessionFiles(sessionId: string, snapshot: PageDoc): Promise<PageDoc> {
  const doc = JSON.parse(JSON.stringify(snapshot)) as PageBundle
  for (const obj of Object.values(doc.objects)) {
    if (obj.metadata.render !== 'file') continue
    const local = await loadSessionFile(obj.id)
    const blob = await getSessionBlob(obj.id)
    if (!local || !blob) continue
    try {
      obj.metadata.fileUrl = await shareBlob(sessionId, obj.id, blob, local.mime)
      obj.metadata.fileName = local.name
      obj.metadata.fileMime = local.mime
    } catch {
      // Sharing is best-effort: the presentation must never fail because a
      // document couldn't upload — the board shows its placeholder instead.
    }
  }

  const pageFileUrl = doc.bundle?.fileUrl
  if (pageFileUrl?.startsWith('opfs:')) {
    const fileId = pageFileUrl.slice('opfs:'.length)
    try {
      const { getFile } = await import('@/lib/storage/manager')
      const blob = await getFile(fileId)
      if (blob) {
        doc.bundle!.fileUrl = await shareBlob(sessionId, 'page', blob, doc.bundle?.fileMime ?? blob.type)
      }
    } catch {
      // Same best-effort contract as file-object uploads above.
    }
  }

  return doc
}

/** Resolve a shared file URL to something renderable. */
export async function resolveSharedFile(url: string): Promise<string | null> {
  if (!url.startsWith('local:')) return url
  const rows = await db.list<{ id: string; data: string }>('session_files', {
    id: url.slice('local:'.length),
  })
  return rows[0]?.data ?? null
}

/** Remove a session's shared files (teacher, after merge/discard). */
export async function cleanupSessionFiles(sessionId: string, snapshot: PageDoc): Promise<void> {
  for (const obj of Object.values(snapshot.objects)) {
    const url = obj.metadata?.fileUrl as string | undefined
    if (!url) continue
    try {
      if (url.startsWith('local:')) {
        await db.removeById('session_files', url.slice('local:'.length))
      } else if (db.dbMode === 'cloud') {
        await fetch(`/api/files/${sessionId}/${obj.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        })
      }
    } catch {
      // best-effort — the 3 h sweep catches leftovers
    }
  }
}
