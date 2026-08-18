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

/** Page ids that must NOT be evicted to reclaim quota — the pages the user
 *  is looking at or drawing on right now (the open page, its split pane, a
 *  doc's sheets, a PDF's per-page ink overlays). Published by the page cache
 *  via `setProtectedPages`; empty means "nothing pinned yet", not "evict
 *  anything". Without this, reclaiming space for one page could delete the
 *  archive of the annotation canvas being drawn on — which read to the user
 *  as ink silently not saving. */
let protectedIds = new Set<string>()

export function setProtectedPages(ids: Iterable<string>): void {
  protectedIds = new Set(ids)
}

/** When a page's archive entry was last written — the LRU signal quota
 *  eviction sorts on. localStorage has no timestamps of its own, and key
 *  index order is insertion order, not recency, so an entry rewritten every
 *  few seconds still sat at a low index and got evicted first. */
const writtenAt = new Map<string, number>()

/**
 * Free space for `keepKey` by dropping the least-recently-written page
 * archives belonging to THIS user, never touching a protected page.
 * Returns true if anything was removed.
 */
export function evictArchives(keepKey: string, want = 10): boolean {
  const prefix = userPrefix()
  const candidates: { k: string; at: number }[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(prefix) || k === keepKey) continue
    if (protectedIds.has(k.slice(prefix.length))) continue
    candidates.push({ k, at: writtenAt.get(k) ?? 0 })
  }
  if (candidates.length === 0) return false
  candidates.sort((a, b) => a.at - b.at) // oldest write first
  for (const { k } of candidates.slice(0, Math.min(want, candidates.length))) {
    localStorage.removeItem(k)
    writtenAt.delete(k)
  }
  return true
}

export function writePage(pageId: string, content: PageDoc): void {
  if (typeof window === 'undefined') return
  const k = key(pageId)
  const value = JSON.stringify(content)
  try {
    localStorage.setItem(k, value)
    writtenAt.set(k, Date.now())
  } catch (e) {
    if (!(e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'))) return
    // Evict the least-recently-written unprotected archives to make room and
    // retry — repeatedly, since one round of 10 may not cover a big page.
    for (let round = 0; round < 5; round++) {
      if (!evictArchives(k)) break
      try {
        localStorage.setItem(k, value)
        writtenAt.set(k, Date.now())
        return
      } catch {
        // still over quota — evict another round
      }
    }
    console.warn('[simblip] could not archive page', pageId, '— localStorage is full')
  }
}

export function dropPage(pageId: string): void {
  if (typeof window === 'undefined') return
  try {
    writtenAt.delete(key(pageId))
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
