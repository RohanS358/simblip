'use client'

// Explicit page deletions, queued for the cloud sync.
//
// The sync used to infer a deletion from a page VANISHING from the doc store's
// `pages` map. That was safe only while the map held every page forever. Now
// that pages are evicted from memory when you switch away from them (lazy
// loading), absence means "not open", not "deleted" — inferring deletion from
// it would wipe the user's notebook from the cloud.
//
// So deletion is now an explicit act: only forgetPage() lands an id here, and
// only ids that land here are deleted remotely.

const pending = new Set<string>()
const listeners = new Set<() => void>()

export function markPageDeleted(pageId: string): void {
  pending.add(pageId)
  listeners.forEach((fn) => fn())
}

/** Take the queued deletions (the caller owns them from here). */
export function drainPageDeletions(): string[] {
  const ids = [...pending]
  pending.clear()
  return ids
}

/** Put them back after a failed push, so nothing is silently dropped. */
export function requeuePageDeletions(ids: string[]): void {
  ids.forEach((id) => pending.add(id))
}

export function onPageDeleted(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
