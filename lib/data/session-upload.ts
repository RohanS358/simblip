'use client'

// Presentation file sharing. When a teacher presents a page that carries
// session documents, the files are pushed somewhere the board (and class
// followers) can reach:
//
//   cloud — the public `simblip-session` Storage bucket under
//           <sessionId>/<objectId>. Deleted when the teacher resolves the
//           presentation, with a 3-hour pg_cron sweep as the safety net
//           (supabase/schema.sql).
//   local — a demo-db table of data URLs (same-browser tabs).
//
// The snapshot's file elements get metadata.fileUrl/fileName/fileMime so
// any viewer without the local file can render them.

import * as db from './db'
import { getAccessToken } from '@/lib/auth/store'
import { getSessionBlob, getSessionFile } from '@/lib/store/session-files'
import type { PageDoc } from '@/lib/scene/types'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const BUCKET = 'simblip-session'

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(blob)
  })

/** Upload every attached session document referenced by the snapshot and
 *  stamp its element with a shareable URL. Returns the enriched snapshot. */
export async function uploadSessionFiles(sessionId: string, snapshot: PageDoc): Promise<PageDoc> {
  const doc = JSON.parse(JSON.stringify(snapshot)) as PageDoc
  for (const obj of Object.values(doc.objects)) {
    if (obj.metadata.render !== 'file') continue
    const local = getSessionFile(obj.id)
    const blob = await getSessionBlob(obj.id)
    if (!local || !blob) continue
    try {
      if (db.dbMode === 'cloud') {
        const path = `${sessionId}/${obj.id}`
        const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'POST',
          headers: {
            apikey: KEY!,
            Authorization: `Bearer ${getAccessToken() ?? KEY}`,
            'Content-Type': local.mime || 'application/octet-stream',
            'x-upsert': 'true',
          },
          body: blob,
        })
        if (!res.ok) throw new Error(await res.text())
        obj.metadata.fileUrl = `${URL_}/storage/v1/object/public/${BUCKET}/${path}`
      } else {
        const data = await blobToDataUrl(blob)
        await db.insert('session_files', { id: `${sessionId}/${obj.id}`, data })
        obj.metadata.fileUrl = `local:${sessionId}/${obj.id}`
      }
      obj.metadata.fileName = local.name
      obj.metadata.fileMime = local.mime
    } catch {
      // Sharing is best-effort: the presentation must never fail because a
      // document couldn't upload — the board shows its placeholder instead.
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
        await fetch(`${URL_}/storage/v1/object/${BUCKET}/${sessionId}/${obj.id}`, {
          method: 'DELETE',
          headers: { apikey: KEY!, Authorization: `Bearer ${getAccessToken() ?? KEY}` },
        })
      }
    } catch {
      // best-effort — the 3 h sweep catches leftovers
    }
  }
}
