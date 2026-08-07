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

export const scopedJSONStorage = createJSONStorage(() => ({
  getItem: (name: string) => localStorage.getItem(scopedKey(name)),
  setItem: (name: string, value: string) => localStorage.setItem(scopedKey(name), value),
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
