'use client'

// File manifest — the source of truth for "what files exist and are they
// synced," stored in IndexedDB (not OPFS-as-JSON). IndexedDB gives queryable
// access (getAll indexed by ownerId/syncStatus) without hand-rolling a JSON
// parse-and-filter pass on every startup, and reads are async so they never
// block first paint — the same reasoning lib/store/ephemeral-storage.ts (the
// module this replaces for durable files) already used IndexedDB for. New DB
// name (`simblip-manifest`) to avoid any collision with that old store.

import type { FileManifestEntry, SyncStatus } from './manifest-types'

const DB_NAME = 'simblip-manifest'
const STORE = 'files'
const OWNER_INDEX = 'ownerId'

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex(OWNER_INDEX, 'ownerId')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const listeners = new Set<(entry: FileManifestEntry) => void>()

/** Simple pub/sub, not a full event bus — manager.ts's sync-queue watcher is
 *  the one subscriber that matters today. */
export function onManifestChange(cb: (entry: FileManifestEntry) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export async function putEntry(entry: FileManifestEntry): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  listeners.forEach((cb) => cb(entry))
}

export async function getEntry(id: string): Promise<FileManifestEntry | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as FileManifestEntry | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function listByStatus(status: SyncStatus): Promise<FileManifestEntry[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const out: FileManifestEntry[] = []
    const req = db.transaction(STORE).objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return resolve(out)
      const entry = cursor.value as FileManifestEntry
      if (entry.syncStatus === status) out.push(entry)
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
  })
}

export async function listByOwner(ownerId: string): Promise<FileManifestEntry[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).index(OWNER_INDEX).getAll(ownerId)
    req.onsuccess = () => resolve(req.result as FileManifestEntry[])
    req.onerror = () => reject(req.error)
  })
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Sign-out wipe for one user's manifest entries. */
export async function clearManifestForOwner(ownerId: string): Promise<void> {
  const entries = await listByOwner(ownerId)
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    entries.forEach((e) => store.delete(e.id))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
