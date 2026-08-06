'use client'

// Public storage API — everything else in the app imports THIS module, not
// opfs.ts/manifest.ts directly. Wires OPFS (bytes) + manifest (identity/sync
// status) + the Vercel Blob upload routes together. Collapsed into one
// module rather than split StorageManager/SyncManager/etc: in this phase
// there's no P2P/device layer to justify separating storage concerns from
// sync concerns — the whole "sync engine" is `listByStatus('local-only')`
// plus a retry loop, not a persisted queue structure of its own (see the
// storage migration plan's non-goals for what's deliberately not built yet).

import { uid } from '@/lib/scene/types'
import { getAccessToken } from '@/lib/auth/store'
import * as opfs from './opfs'
import * as manifest from './manifest'
import type { FileManifestEntry } from './manifest-types'

async function sha256(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Store a new file: writes OPFS, creates a manifest entry (local-only), and
 *  kicks off a background Blob upload. Returns the manifest id to hang a
 *  FileNode.fileId (lib/scene/types.ts) off of. */
export async function putFile(blob: Blob, name: string, mime: string, ownerId: string): Promise<string> {
  const id = uid()
  await opfs.writeFile(id, blob)
  const entry: FileManifestEntry = {
    id,
    ownerId,
    name,
    mime,
    size: blob.size,
    sha256: await sha256(blob),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    syncStatus: 'local-only',
    cloudBackedUp: false,
  }
  await manifest.putEntry(entry)
  void uploadToCloud(entry).catch(() => {
    // Left as local-only/sync-failed — retried from the startup sweep
    // (retrySyncQueue) or the next putFile-adjacent call, never blocks the
    // caller who just wants their file stored locally right now.
  })
  return id
}

/** Read a file: OPFS first (offline-first). Falls back to fetching the Blob
 *  copy (e.g. a new device that hasn't seeded this file locally yet) and
 *  re-seeds OPFS + manifest so the next read is local. */
export async function getFile(fileId: string): Promise<Blob | null> {
  const local = await opfs.readFile(fileId)
  if (local) return local

  const entry = await manifest.getEntry(fileId)
  if (!entry?.cloudUrl) return null
  try {
    const res = await fetch(`/api/storage/${fileId}`)
    if (!res.ok) return null
    const blob = await res.blob()
    await opfs.writeFile(fileId, blob)
    return blob
  } catch {
    return null
  }
}

export async function deleteFiles(fileIds: string[]): Promise<void> {
  const token = getAccessToken()
  await Promise.all(
    fileIds.map(async (id) => {
      await opfs.deleteFile(id)
      await manifest.deleteEntry(id)
      if (token) {
        try {
          await fetch(`/api/storage/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
        } catch {
          // best-effort — the local copy is already gone, which is what matters
        }
      }
    })
  )
}

/** Push one manifest entry's bytes to Vercel Blob and record the row via the
 *  existing /api/pg gateway (same pattern simblip_pages already uses — see
 *  app/api/pg/[table]/route.ts's file_manifest entry). */
async function uploadToCloud(entry: FileManifestEntry): Promise<void> {
  const token = getAccessToken()
  if (!token) return // offline/local-demo mode — stays local-only, not an error
  await manifest.putEntry({ ...entry, syncStatus: 'uploading' })
  try {
    const blob = await opfs.readFile(entry.id)
    if (!blob) throw new Error('local blob missing')

    const { upload } = await import('@vercel/blob/client')
    const result = await upload(entry.id, blob, {
      access: 'public',
      handleUploadUrl: '/api/storage/upload-url',
      clientPayload: JSON.stringify({ mime: entry.mime }),
      headers: { Authorization: `Bearer ${token}` },
    })

    await fetch('/api/pg/simblip_file_manifest', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([
        {
          id: entry.id,
          owner_id: entry.ownerId,
          name: entry.name,
          mime: entry.mime,
          size: entry.size,
          sha256: entry.sha256,
          blob_url: result.url,
          updated_at: new Date().toISOString(),
        },
      ]),
    })

    await manifest.putEntry({ ...entry, syncStatus: 'synced', cloudBackedUp: true, cloudUrl: result.url })
  } catch {
    await manifest.putEntry({ ...entry, syncStatus: 'sync-failed' })
  }
}

/** Call once at app bootstrap (same place lib/sync/cloud.ts's startSync()
 *  fires from) — retries any file that never finished uploading last
 *  session. This IS "the sync queue": a status scan plus a retry loop, not a
 *  separately persisted queue. */
export async function retrySyncQueue(): Promise<void> {
  const pending = [...(await manifest.listByStatus('local-only')), ...(await manifest.listByStatus('sync-failed'))]
  for (const entry of pending) void uploadToCloud(entry)
}
