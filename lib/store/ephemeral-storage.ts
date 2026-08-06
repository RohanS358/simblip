'use client'

// Ephemeral runtime file store — deliberately OUTSIDE the durable storage/
// synchronization architecture (lib/storage/manager.ts's OPFS + manifest +
// Vercel Blob system). This module's ONLY remaining caller is
// components/objects/file-view.tsx's 'file' geometry kind: a document
// dropped directly onto a canvas board, explicitly documented as
// "session-only, never saved." That's a genuinely different storage
// lifetime from a durable uploaded file (a pdf-kind notebook page, or a
// folder-tree FileNode) — it dies with the session/sign-out by design, not
// as a phase-1 gap, so it must never be folded into the persistent system.
//
// (Historically this module also served pdf-kind notebook pages — that
// responsibility has moved to lib/storage/manager.ts; see
// lib/store/pdf-attach.ts and lib/storage/migrate-session-files.ts.)
//
// Attached documents live as blob URLs in memory AND — so they survive
// reloads on this device for the remainder of the session — as Blobs in
// IndexedDB, keyed per signed-in user. They are wiped at sign-out
// (lib/auth/store.ts) and are never written to the app database.
//
// IndexedDB replaced localStorage: data-URL persistence capped files at
// ~4 MB and burned quota; Blobs in IDB have no such ceiling. Old
// localStorage entries are migrated on first read, then removed.

import { ACTIVE_USER_KEY } from '@/lib/auth/store'

export interface SessionFile {
  url: string
  name: string
  mime: string
}

interface StoredFile {
  name: string
  mime: string
  blob: Blob
}

const files = new Map<string, SessionFile>()

const userId = () =>
  typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_USER_KEY) ?? 'anon' : 'anon'
const idbKey = (objectId: string, user = userId()) => `${user}:${objectId}`

// ── IndexedDB plumbing ──────────────────────────────────────────────────────

const DB_NAME = 'simblip-files'
const STORE = 'files'

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function idbPut(key: string, value: StoredFile): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet(key: string): Promise<StoredFile | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as StoredFile | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbDeleteUser(user: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    // '￿' sorts after any printable char, so this range spans every
    // key belonging to `${user}:`.
    tx.objectStore(STORE).delete(IDBKeyRange.bound(`${user}:`, `${user}:￿`))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Legacy localStorage migration (pre-IndexedDB persisted copies) ──────────

interface LegacyPersisted {
  name: string
  mime: string
  data: string // data URL
}

const legacyKey = () => `simblip-session-files:${userId()}`

function takeLegacy(objectId: string): LegacyPersisted | null {
  try {
    const map = JSON.parse(localStorage.getItem(legacyKey()) ?? '{}') as Record<string, LegacyPersisted>
    const hit = map[objectId]
    if (!hit) return null
    delete map[objectId]
    localStorage.setItem(legacyKey(), JSON.stringify(map))
    return hit
  } catch {
    return null
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function putSessionFile(objectId: string, file: File): SessionFile {
  const prev = files.get(objectId)
  if (prev) URL.revokeObjectURL(prev.url)
  const entry = { url: URL.createObjectURL(file), name: file.name, mime: file.type }
  files.set(objectId, entry)
  void idbPut(idbKey(objectId), { name: file.name, mime: file.type, blob: file }).catch(() => {
    // storage denied/full — the in-memory copy still works for this session
  })
  return entry
}

/** Synchronous, in-memory only — for render paths. May miss right after a
 *  reload; pair with loadSessionFile in an effect for the persisted copy. */
export function getSessionFile(objectId: string): SessionFile | null {
  return files.get(objectId) ?? null
}

/** Memory → IndexedDB → legacy localStorage. Caches whatever it finds. */
export async function loadSessionFile(objectId: string): Promise<SessionFile | null> {
  const hit = files.get(objectId)
  if (hit) return hit
  if (typeof window === 'undefined') return null
  try {
    const stored = await idbGet(idbKey(objectId))
    if (stored) {
      const entry = { url: URL.createObjectURL(stored.blob), name: stored.name, mime: stored.mime }
      files.set(objectId, entry)
      return entry
    }
  } catch {
    // fall through to legacy
  }
  const legacy = takeLegacy(objectId)
  if (!legacy) return null
  const blob = await (await fetch(legacy.data)).blob()
  void idbPut(idbKey(objectId), { name: legacy.name, mime: legacy.mime, blob }).catch(() => {})
  const entry = { url: URL.createObjectURL(blob), name: legacy.name, mime: legacy.mime }
  files.set(objectId, entry)
  return entry
}

/** Raw blob for uploading (presentation sharing). */
export async function getSessionBlob(objectId: string): Promise<Blob | null> {
  const f = await loadSessionFile(objectId)
  if (!f) return null
  try {
    return await (await fetch(f.url)).blob()
  } catch {
    return null
  }
}

/** Sign-out wipe for the given user id. */
export function clearSessionFiles(userId: string | null) {
  files.forEach((f) => f.url.startsWith('blob:') && URL.revokeObjectURL(f.url))
  files.clear()
  if (typeof window === 'undefined') return
  localStorage.removeItem(`simblip-session-files:${userId ?? 'anon'}`)
  void idbDeleteUser(userId ?? 'anon').catch(() => {})
}
