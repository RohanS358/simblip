'use client'

// Explicit page deletions, queued for the cloud sync.
//
// The sync used to infer a deletion from a page VANISHING from the doc store's
// `pages` map. That was safe only while the map held every page forever. Now
// that pages are evicted from memory when you switch away from them (lazy
// loading), absence means "not open", not "deleted" — inferring deletion from
// it would wipe the user's notebook from the cloud.
//
// So deletion is an explicit act: only forgetPage() (and a page switched to
// "keep on this device") lands an id here, and only ids that land here are
// deleted remotely.
//
// The queue is PERSISTED per user. It used to be memory-only, so deleting a
// page and closing the tab before the next push left its content row in the
// cloud forever — still counted against the storage quota, with nothing left
// on any device that knew to delete it.

import { ACTIVE_USER_KEY } from '@/lib/auth/store'

const listeners = new Set<() => void>()

const storageKey = () => {
  const user = typeof window === 'undefined' ? null : localStorage.getItem(ACTIVE_USER_KEY)
  return `simblip-pending-deletes:${user ?? ''}`
}

function load(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey()) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function save(ids: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    if (ids.size === 0) localStorage.removeItem(storageKey())
    else localStorage.setItem(storageKey(), JSON.stringify([...ids]))
  } catch {
    // Storage full: the in-flight push still carries the ids this session.
  }
}

export function markPageDeleted(pageId: string): void {
  const ids = load()
  ids.add(pageId)
  save(ids)
  listeners.forEach((fn) => fn())
}

/** Peek at the queue without taking ownership. */
export function pendingPageDeletions(): string[] {
  return [...load()]
}

/** Take the queued deletions (the caller owns them from here). */
export function drainPageDeletions(): string[] {
  const ids = [...load()]
  save(new Set())
  return ids
}

/** Put them back after a failed push, so nothing is silently dropped. */
export function requeuePageDeletions(ids: string[]): void {
  if (ids.length === 0) return
  const cur = load()
  ids.forEach((id) => cur.add(id))
  save(cur)
}

/** A page that came back (restored, re-synced) must not be deleted later. */
export function cancelPageDeletion(pageId: string): void {
  const cur = load()
  if (cur.delete(pageId)) save(cur)
}

export function onPageDeleted(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
