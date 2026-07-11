'use client'

// Session-only file store. Attached PDFs/decks live as object URLs in this
// in-memory map — they are NEVER persisted or synced (the page keeps a
// placeholder element; the bytes vanish when the tab closes, by design).

interface SessionFile {
  url: string
  name: string
  mime: string
}

const files = new Map<string, SessionFile>()
const listeners = new Set<() => void>()

export function putSessionFile(objectId: string, file: File): SessionFile {
  const prev = files.get(objectId)
  if (prev) URL.revokeObjectURL(prev.url)
  const entry = { url: URL.createObjectURL(file), name: file.name, mime: file.type }
  files.set(objectId, entry)
  listeners.forEach((fn) => fn())
  return entry
}

export const getSessionFile = (objectId: string) => files.get(objectId) ?? null

export function subscribeSessionFiles(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
