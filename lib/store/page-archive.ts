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
//
// Two tiers: localStorage is the synchronous cache ensurePage reads in the
// same tick; IndexedDB (page-archive-idb.ts) is the durable copy of every
// page. Quota eviction only ever drops a localStorage entry whose IndexedDB
// copy is confirmed written — it used to delete the only copy of pages that
// had never synced.

import { ACTIVE_USER_KEY } from '@/lib/auth/store'
import { idbDelete, idbGet, idbKeys, idbPut } from '@/lib/store/page-archive-idb'
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

/** Keys whose CURRENT content is confirmed in IndexedDB — the only entries
 *  eviction may drop. Seeded from IndexedDB on load; a key being rewritten is
 *  removed until its new value lands, so a stale mirror never licenses
 *  evicting newer content. */
const mirrored = new Set<string>()
const writeSeq = new Map<string, number>()
if (typeof window !== 'undefined') {
  // Seed from IndexedDB, then backfill any page that predates the durable
  // tier (written to localStorage only) so it becomes durable — and
  // evictable — too.
  void idbKeys()
    .then((ks) => {
      ks.forEach((k) => mirrored.add(k))
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k?.startsWith(PREFIX + ':') || mirrored.has(k)) continue
        const v = localStorage.getItem(k)
        if (v) mirror(k, v)
      }
    })
    .catch(() => {})
}

function mirror(k: string, value: string): void {
  // Only the LATEST write for a key may mark it mirrored — an older put that
  // completes first must not license evicting newer localStorage content.
  const seq = (writeSeq.get(k) ?? 0) + 1
  writeSeq.set(k, seq)
  mirrored.delete(k)
  void idbPut(k, value)
    .then(() => {
      if (writeSeq.get(k) === seq) mirrored.add(k)
    })
    .catch((e) => console.warn('[simblip] durable page write failed', k, e))
}

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
    if (!mirrored.has(k)) continue // its only copy — never evict
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
  mirror(k, value)
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
    // The IndexedDB copy above still holds it; drop the now-stale cache entry
    // so a later readPage falls through to the durable copy instead.
    try {
      localStorage.removeItem(k)
    } catch {
      /* nothing to do */
    }
  }
}

export function dropPage(pageId: string): void {
  if (typeof window === 'undefined') return
  try {
    writtenAt.delete(key(pageId))
    mirrored.delete(key(pageId))
    localStorage.removeItem(key(pageId))
    void idbDelete(key(pageId)).catch(() => {})
  } catch {
    /* nothing to do */
  }
}

export function hasPage(pageId: string): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(key(pageId)) !== null
}

/** The durable copy, for a page whose localStorage entry was evicted. */
export async function readPageDurable(pageId: string): Promise<PageDoc | null> {
  try {
    const raw = await idbGet(key(pageId))
    return raw ? (JSON.parse(raw) as PageDoc) : null
  } catch {
    return null
  }
}

/** Every page id this user has archived, in either tier. */
export async function archivedPageIdsDurable(): Promise<string[]> {
  const p = userPrefix()
  const ids = new Set(archivedPageIds())
  try {
    for (const k of await idbKeys()) if (k.startsWith(p)) ids.add(k.slice(p.length))
  } catch {
    /* localStorage tier only */
  }
  return [...ids]
}

/** Every page id this user has archived in the localStorage tier. */
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
