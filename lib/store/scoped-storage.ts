'use client'

// Per-user localStorage. Authentication is mandatory, and several accounts
// (teacher, student, a room board) may share one machine — so the notebook
// stores persist under `<name>:<userId>`. The active user id is written by
// the auth store at login, before any store hydrates.

import { createJSONStorage } from 'zustand/middleware'
import { ACTIVE_USER_KEY } from '@/lib/auth/store'
import { evictArchives } from '@/lib/store/page-archive'

function scopedKey(name: string): string {
  if (typeof window === 'undefined') return name
  const user = localStorage.getItem(ACTIVE_USER_KEY)
  return user ? `${name}:${user}` : name
}

/**
 * Evict page archives to free space, then retry.
 *
 * Delegates to the page archive's own eviction (lib/store/page-archive.ts):
 * least-recently-written first, this user's pages only, and never a page
 * that's currently on screen. The old version here swept every
 * `simblip-page*` key across ALL users in localStorage index order, which
 * could delete the archive of the PDF annotation canvas the user was drawing
 * on at that moment — ink that had been saved a second earlier just vanished.
 */
function evictAndRetry(key: string, value: string): void {
  if (typeof window === 'undefined') return
  for (let round = 0; round < 5; round++) {
    if (!evictArchives(key)) break
    try {
      localStorage.setItem(key, value)
      return
    } catch {
      // still over quota — evict another round
    }
  }
  console.warn('[simblip] localStorage quota exceeded even after eviction; write dropped for', key)
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      evictAndRetry(key, value)
    }
    // Other errors (security, private-browsing) — silently ignore.
  }
}

/**
 * Debounces the actual disk write, not the value zustand sees.
 *
 * zustand's persist middleware writes on EVERY store `set()` with no
 * built-in coalescing — a burst of state changes (e.g. scrolling through a
 * presentation) fires that many synchronous localStorage writes back to
 * back, each JSON.stringify-ing the whole store. On Windows especially
 * (antivirus/OneDrive scanning the profile dir) that's a visible multi-
 * second stall. Collapsing a burst into one write after it settles removes
 * that without changing what's on disk once things are quiet.
 */
const WRITE_DEBOUNCE_MS = 300
const pending = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>()

function flush(key: string): void {
  const p = pending.get(key)
  if (!p) return
  pending.delete(key)
  safeSetItem(key, p.value)
}

/** Flush every pending write immediately — call before the page can go away. */
function flushAll(): void {
  for (const key of Array.from(pending.keys())) flush(key)
}

if (typeof window !== 'undefined') {
  // 'pagehide' covers back/forward-cache navigations; 'beforeunload' covers
  // a close/refresh that skips bfcache; visibilitychange covers a phone
  // backgrounding the tab (no unload event fires there at all).
  window.addEventListener('pagehide', flushAll)
  window.addEventListener('beforeunload', flushAll)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll()
  })
}

export const scopedJSONStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    const key = scopedKey(name)
    // Read-your-writes: a debounced write hasn't hit localStorage yet, so
    // serve the in-flight value instead of the stale one still on disk.
    return pending.get(key)?.value ?? localStorage.getItem(key)
  },
  setItem: (name: string, value: string) => {
    const key = scopedKey(name)
    const existing = pending.get(key)
    if (existing) clearTimeout(existing.timer)
    pending.set(key, { value, timer: setTimeout(() => flush(key), WRITE_DEBOUNCE_MS) })
  },
  removeItem: (name: string) => {
    const key = scopedKey(name)
    const existing = pending.get(key)
    if (existing) {
      clearTimeout(existing.timer)
      pending.delete(key)
    }
    localStorage.removeItem(key)
  },
}))

/** Force the persisted stores to re-read from the (re-)scoped keys. */
export async function rehydrateUserStores() {
  // The account switch that triggers this changes scopedKey's output for
  // every store — flush first, or the outgoing user's last debounced write
  // (still keyed to their old scoped name) never lands.
  flushAll()
  const { useWorkspaceStore } = await import('@/lib/store/workspace')
  const { useDocStore } = await import('@/lib/store/document')
  const { useFilePageContentStore } = await import('@/lib/store/file-page-content')
  const { useMobileTabStore } = await import('@/lib/store/mobile-tab')
  const { useConsent } = await import('@/lib/store/consent')
  const { useSyncPrefsStore } = await import('@/lib/sync/sync-prefs')
  const { useNotesGallery } = await import('@/lib/store/notes-gallery')
  await useWorkspaceStore.persist.rehydrate()
  await useDocStore.persist.rehydrate()
  await useFilePageContentStore.persist.rehydrate()
  // The note gallery is the account's scrapbook — a login switch must not
  // leave the previous user's notes and events on screen.
  await useNotesGallery.persist.rehydrate()
  // Terms acceptance and the analytics choice belong to the account, not the
  // browser — without this a login switch would show the incoming user the
  // previous user's answers.
  await useConsent.persist.rehydrate()
  await useSyncPrefsStore.persist.rehydrate()
  // Last-session screen — scoped per user like the rest, so a login switch
  // reads the incoming user's own last view instead of keeping the previous
  // one on screen.
  await useMobileTabStore.persist.rehydrate()
}
