'use client'

// Per-user localStorage. Authentication is mandatory, and several accounts
// (teacher, student, a room board) may share one machine — so the notebook
// stores persist under `<name>:<userId>`. The active user id is written by
// the auth store at login, before any store hydrates.

import { createJSONStorage } from 'zustand/middleware'
import { ACTIVE_USER_KEY } from '@/lib/auth/store'

function scopedKey(name: string): string {
  if (typeof window === 'undefined') return name
  const user = localStorage.getItem(ACTIVE_USER_KEY)
  return user ? `${name}:${user}` : name
}

/** Evict the oldest simblip-page:* archive entries to free space, then retry. */
function evictAndRetry(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    // Find all page archive keys and sort by recency (localStorage has no
    // built-in LRU, so we use index order as a proxy — pages archived earlier
    // appear at lower indices).
    const pageKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('simblip-page')) pageKeys.push(k)
    }
    // Evict up to 10 pages at a time to make room.
    const toEvict = pageKeys.slice(0, Math.min(10, pageKeys.length))
    toEvict.forEach((k) => localStorage.removeItem(k))
    localStorage.setItem(key, value)
  } catch {
    // If still over quota after eviction, silently drop — the cloud copy is
    // still the durable source of truth, so nothing is permanently lost.
    console.warn('[simblip] localStorage quota exceeded even after eviction; write dropped for', key)
  }
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
  await useWorkspaceStore.persist.rehydrate()
  await useDocStore.persist.rehydrate()
  await useFilePageContentStore.persist.rehydrate()
}
