'use client'

// Session file store. Attached documents live as blob URLs in memory AND —
// so they survive reloads on this device — as data URLs in localStorage,
// keyed per signed-in user. They are wiped at sign-out (lib/auth/store.ts)
// and are never written to the app database. Very large files (>4 MB) stay
// memory-only to respect localStorage quotas.

import { ACTIVE_USER_KEY } from '@/lib/auth/store'

interface SessionFile {
  url: string
  name: string
  mime: string
}

const PERSIST_LIMIT = 4 * 1024 * 1024

const storageKey = () =>
  `simblip-session-files:${typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_USER_KEY) ?? 'anon' : 'anon'}`

const files = new Map<string, SessionFile>()

interface Persisted {
  name: string
  mime: string
  data: string // data URL
}

function readPersisted(): Record<string, Persisted> {
  try {
    return JSON.parse(localStorage.getItem(storageKey()) ?? '{}') as Record<string, Persisted>
  } catch {
    return {}
  }
}

function writePersisted(map: Record<string, Persisted>) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(map))
  } catch {
    // quota exceeded — the in-memory copy still works for this session
  }
}

export function putSessionFile(objectId: string, file: File): SessionFile {
  const prev = files.get(objectId)
  if (prev) URL.revokeObjectURL(prev.url)
  const entry = { url: URL.createObjectURL(file), name: file.name, mime: file.type }
  files.set(objectId, entry)
  if (file.size <= PERSIST_LIMIT) {
    const reader = new FileReader()
    reader.onload = () => {
      const map = readPersisted()
      map[objectId] = { name: file.name, mime: file.type, data: String(reader.result) }
      writePersisted(map)
    }
    reader.readAsDataURL(file)
  }
  return entry
}

/** In-memory first; falls back to the per-user persisted copy (reload case). */
export function getSessionFile(objectId: string): SessionFile | null {
  const hit = files.get(objectId)
  if (hit) return hit
  if (typeof window === 'undefined') return null
  const p = readPersisted()[objectId]
  if (!p) return null
  const entry = { url: p.data, name: p.name, mime: p.mime } // data URL renders directly
  files.set(objectId, entry)
  return entry
}

/** Raw blob for uploading (presentation sharing). */
export async function getSessionBlob(objectId: string): Promise<Blob | null> {
  const f = getSessionFile(objectId)
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
  if (typeof window !== 'undefined')
    localStorage.removeItem(`simblip-session-files:${userId ?? 'anon'}`)
}
