'use client'

// One-time migration of existing uploaded PDFs off the old IndexedDB cache
// (lib/store/session-files.ts, being renamed/re-scoped to
// lib/store/ephemeral-storage.ts) onto the new OPFS + manifest system. Runs
// once per signed-in user, idempotent (localStorage guard), and — because it
// touches IndexedDB/OPFS/network — must be async, so it can't live inside a
// zustand onRehydrateStorage hook (those have to stay synchronous). Fired
// from the same effect that already boots the sync engine
// (components/workspace/sync-status.tsx's startSync() call).

import { useWorkspaceStore } from '@/lib/store/workspace'
import type { PageNode } from '@/lib/scene/types'
import { getSessionBlob } from '@/lib/store/ephemeral-storage'
import { putFile } from './manager'

const guardKey = (userId: string) => `simblip-session-files-migrated:${userId}`

export async function migrateSessionFilesToOpfs(userId: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(guardKey(userId))) return // already migrated for this user

  const nodes = useWorkspaceStore.getState().nodes
  const pdfPages = Object.values(nodes).filter(
    (n): n is PageNode => n.kind === 'page' && n.pageKind === 'pdf' && !n.fileUrl?.startsWith('opfs:')
  )

  for (const page of pdfPages) {
    // Local IndexedDB copy first (the common case — this device uploaded or
    // already opened the file). Falls back to the old cloud seed
    // (app/api/files, unchanged, 7-day rolling TTL for notebook/ paths) for
    // a page whose file was only ever seeded to ANOTHER device that hasn't
    // migrated yet — narrows the "file silently vanishes" case versus
    // giving up immediately. Anything missing from both is accepted loss:
    // it was ephemeral-by-design in the old system (the durable source of
    // truth was always whichever device actually did the upload).
    let blob = await getSessionBlob(page.id)
    if (!blob && page.fileUrl?.startsWith('/api/files/')) {
      try {
        const res = await fetch(page.fileUrl)
        if (res.ok) blob = await res.blob()
      } catch {
        // network/expired — fall through to "not found"
      }
    }
    if (!blob) continue

    const fileId = await putFile(blob, page.fileName ?? page.name, page.fileMime ?? 'application/pdf', userId)
    // Marker so pdf-view.tsx's existing "already have a local copy" check
    // (it inspects meta.fileUrl) still short-circuits correctly post-migration.
    useWorkspaceStore.getState().updatePageMeta(page.id, { fileUrl: `opfs:${fileId}` })
  }

  localStorage.setItem(guardKey(userId), '1')
}
