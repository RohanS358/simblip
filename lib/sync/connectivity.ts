'use client'

// Shared "the browser just regained connectivity" hook — both cloud.ts (page
// sync) and device-file-sync.ts (file sync) need to resume a failed push the
// moment the network returns, instead of waiting for the next unrelated edit.

export function onReconnect(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', cb)
  return () => window.removeEventListener('online', cb)
}
