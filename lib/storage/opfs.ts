'use client'

// Raw Origin Private File System access — no knowledge of the manifest or
// network sync, just read/write/delete a binary by its manifest id. Flat
// namespace (/simblip/<userId>/files/<manifestFileId>), NOT mirroring the
// notebook tree's folder hierarchy: nothing ever reads OPFS by path, only by
// manifest id (resolved via lib/storage/manifest.ts), so mirroring the tree
// would mean renaming files on disk every time a FileNode is reparented
// (workspace.ts's moveNode) for zero benefit. A flat namespace also means
// startup never needs to recursively walk OPFS directories — every lookup is
// an O(1) getFileHandle by id.

import { ACTIVE_USER_KEY } from '@/lib/auth/store'

function userId(): string {
  return typeof window !== 'undefined' ? (localStorage.getItem(ACTIVE_USER_KEY) ?? 'anon') : 'anon'
}

/** True in any browser that implements the OPFS sync/async access-handle
 *  APIs this module needs. Callers should fall back to IndexedDB-only
 *  behavior (or refuse the feature) when this is false rather than letting
 *  every OPFS call throw. */
export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage
}

async function filesDir(user = userId()): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  const simblip = await root.getDirectoryHandle('simblip', { create: true })
  const userDir = await simblip.getDirectoryHandle(user, { create: true })
  return userDir.getDirectoryHandle('files', { create: true })
}

export async function writeFile(fileId: string, blob: Blob): Promise<void> {
  const dir = await filesDir()
  const handle = await dir.getFileHandle(fileId, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

export async function readFile(fileId: string): Promise<Blob | null> {
  try {
    const dir = await filesDir()
    const handle = await dir.getFileHandle(fileId)
    return await handle.getFile()
  } catch {
    return null // NotFoundError — the common case, not an error worth logging
  }
}

export async function deleteFile(fileId: string): Promise<void> {
  try {
    const dir = await filesDir()
    await dir.removeEntry(fileId)
  } catch {
    // already gone — deleteFile is idempotent
  }
}

/** Sign-out wipe for one user's OPFS files (mirrors clearSessionFiles'
 *  per-user teardown in the ephemeral store). */
export async function clearOpfsFiles(user: string | null): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const simblip = await root.getDirectoryHandle('simblip')
    await simblip.removeEntry(user ?? 'anon', { recursive: true })
  } catch {
    // nothing to clear
  }
}
