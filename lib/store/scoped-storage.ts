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

export const scopedJSONStorage = createJSONStorage(() => ({
  getItem: (name: string) => localStorage.getItem(scopedKey(name)),
  setItem: (name: string, value: string) => safeSetItem(scopedKey(name), value),
  removeItem: (name: string) => localStorage.removeItem(scopedKey(name)),
}))

/** Force the persisted stores to re-read from the (re-)scoped keys. */
export async function rehydrateUserStores() {
  const { useWorkspaceStore } = await import('@/lib/store/workspace')
  const { useDocStore } = await import('@/lib/store/document')
  const { useFilePageContentStore } = await import('@/lib/store/file-page-content')
  const { useMobileTabStore } = await import('@/lib/store/mobile-tab')
  const { useConsent } = await import('@/lib/store/consent')
  const { useSyncPrefsStore } = await import('@/lib/sync/sync-prefs')
  await useWorkspaceStore.persist.rehydrate()
  await useDocStore.persist.rehydrate()
  await useFilePageContentStore.persist.rehydrate()
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
