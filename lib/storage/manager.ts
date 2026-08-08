'use client'

// Public storage API — everything else in the app imports THIS module, not
// opfs.ts/manifest.ts directly. Wires OPFS (bytes) + manifest (identity/sync
// status) + the Vercel Blob upload routes together.
//
// OFFLINE-ONLY BY DEFAULT: putFile() never touches the network — every file
// (image, PDF, whatever) lives in OPFS on this device and nowhere else,
// full stop. The 1GB Blob budget this app runs on can't afford "every file
// everyone uploads sits in the cloud forever." uploadToCloud() still exists
// and is exported, but it's now a building block for two narrow, explicit,
// self-cleaning callers only:
//   - a board presentation's temporary session upload (lib/data/boards.ts's
//     startSession(), which already has its own cleanup path)
//   - the device-to-device sync flow (planned: a five-minute heartbeat that
//     diffs two active devices' manifests, uploads only what's missing on
//     the other side, and deletes the Blob copy the moment it's pulled)
// Nothing else should call uploadToCloud() — a file a user never explicitly
// shares or presents should never leave this device.

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

/** Store a new file: writes OPFS, creates a manifest entry. Local only —
 *  see this file's header. Returns the manifest id to hang a FileNode.fileId
 *  (lib/scene/types.ts) off of. */
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
  return id
}

type ManifestRow = {
  id: string
  owner_id: string
  name: string
  mime: string
  size: number
  sha256: string
  blob_url: string
  updated_at: string
}

/** Read a file: OPFS first (offline-first) — the only place a file normally
 *  lives, since putFile() no longer uploads anywhere. Falls back to fetching
 *  a Blob copy for the narrow cases where one transiently exists (mid device
 *  sync, or a board session's presentation upload) and re-seeds OPFS +
 *  manifest so the next read is local. /api/storage/[id] resolves blob_url
 *  server-side from simblip_file_manifest by owner_id, no client-known
 *  cloudUrl required. */
export async function getFile(fileId: string): Promise<Blob | null> {
  const local = await opfs.readFile(fileId)
  if (local) return local

  const token = getAccessToken()
  if (!token) return null
  try {
    const res = await fetch(`/api/storage/${fileId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const blob = await res.blob()
    await opfs.writeFile(fileId, blob)

    void fetch(`/api/pg/simblip_file_manifest?id=eq.${fileId}&select=*`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? (r.json() as Promise<ManifestRow[]>) : []))
      .then(([row]) => {
        if (!row) return
        return manifest.putEntry({
          id: row.id,
          ownerId: row.owner_id,
          name: row.name,
          mime: row.mime,
          size: row.size,
          sha256: row.sha256,
          createdAt: Date.parse(row.updated_at),
          modifiedAt: Date.parse(row.updated_at),
          syncStatus: 'synced',
          cloudBackedUp: true,
          cloudUrl: row.blob_url,
        })
      })
      .catch(() => {
        // best-effort — the file itself is already cached in OPFS, which is
        // what matters; a missing manifest row just means this device's
        // "my files" list won't show it until the next successful pull
      })

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
 *  app/api/pg/[table]/route.ts's file_manifest entry). Exported for the two
 *  explicit callers this file's header describes — never call this just
 *  because a file exists locally; see putFile()'s doc comment. */
export async function uploadToCloud(entry: FileManifestEntry): Promise<void> {
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

