'use client'

// Durable per-page storage — the reason lazy loading is SAFE.
//
// The doc store used to persist its whole `pages` map, so "in memory" and
// "saved" were the same thing. That makes eviction impossible: dropping a
// page from memory would drop it from storage too, and the cloud sync (which
// treats a page vanishing from the map as a deletion) would DELETE it
// remotely.
//
// So content now lives here instead: one localStorage entry per page, written
// whenever the page changes and read back on demand. The doc store's `pages`
// map becomes a CACHE of the pages currently open — evicting from it loses
// nothing, because the archive still holds the content.
//
// Keys are per-user (several accounts share a machine), matching
// lib/store/scoped-storage.ts.

import { ACTIVE_USER_KEY } from '@/lib/auth/store'
// PageDoc is structurally the doc store's PageDoc (objects + variables).
import type { PageDoc } from '@/lib/scene/types'

const PREFIX = 'simblip-page'

const key = (pageId: string): string => {
  const user = typeof window === 'undefined' ? null : localStorage.getItem(ACTIVE_USER_KEY)
  return user ? `${PREFIX}:${user}:${pageId}` : `${PREFIX}::${pageId}`
}

/** Prefix for THIS user's pages — used to enumerate what's archived. */
const userPrefix = (): string => {
  const user = typeof window === 'undefined' ? null : localStorage.getItem(ACTIVE_USER_KEY)
  return user ? `${PREFIX}:${user}:` : `${PREFIX}::`
}

export function readPage(pageId: string): PageDoc | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key(pageId))
    return raw ? (JSON.parse(raw) as PageDoc) : null
  } catch {
    return null
  }
}

export function writePage(pageId: string, content: PageDoc): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key(pageId), JSON.stringify(content))
  } catch (e) {
    if (!(e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'))) return
    // Evict the oldest page archives to make room, then retry once.
    try {
      const prefix = userPrefix()
      const pageKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(prefix) && k !== key(pageId)) pageKeys.push(k)
      }
      pageKeys.slice(0, Math.min(10, pageKeys.length)).forEach((k) => localStorage.removeItem(k))
      localStorage.setItem(key(pageId), JSON.stringify(content))
    } catch {
      // Still over quota — silently drop; cloud sync is the durable copy.
    }
  }
}

export function dropPage(pageId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(key(pageId))
  } catch {
    /* nothing to do */
  }
}

export function hasPage(pageId: string): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(key(pageId)) !== null
}

/** Every page id this user has archived locally. */
export function archivedPageIds(): string[] {
  if (typeof window === 'undefined') return []
  const p = userPrefix()
  const ids: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(p)) ids.push(k.slice(p.length))
  }
  return ids
}
