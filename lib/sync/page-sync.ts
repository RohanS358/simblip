'use client'

// Per-page cloud sync opt-in — the page-level twin of the per-file toggle in
// lib/storage/manager.ts (`syncEnabled` on a manifest entry).
//
// Default OFF. A page's tree NODE always syncs (that's how another device
// knows the page exists at all, same rule the file manifest row follows);
// what this gates is everything expensive and personal:
//
//   • the page's CONTENT rows in simblip_pages (lib/sync/cloud.ts), including
//     every sub-sheet / notes / annotation canvas the page owns, and
//   • the BYTES of every image or source file the page references
//     (lib/sync/device-file-sync.ts).
//
// Images are DERIVED, not copied: a page's file ids are recomputed from the
// live tree + page content on every push, so an image dropped onto a synced
// page after the toggle is covered automatically instead of silently staying
// local. The per-file flag still works on its own — the two are OR'd.

// NOTE: the workspace store is imported dynamically inside setPageSyncEnabled,
// not at module scope — workspace.ts imports contentIdsOf from here for its own
// delete path, and a static import back would close the cycle.
import { useDocStore } from '@/lib/store/document'
import { markPageDeleted } from '@/lib/store/deleted-pages'
import type { FolderNode, Node, PageNode } from '@/lib/scene/types'
import { globalPrefAllowsPage } from '@/lib/sync/sync-prefs'

/** Walk up the tree from a node's parent to see if any ancestor folder has
 *  syncEnabled === true. If so, the node inherits that setting. */
function ancestorFolderSynced(nodes: Record<string, Node>, nodeId: string): boolean {
  let cur: Node | undefined = nodes[nodeId]
  while (cur) {
    const parent: Node | undefined = cur.parentId ? nodes[cur.parentId] : undefined
    if (parent?.kind === 'folder' && (parent as FolderNode).syncEnabled === true) return true
    cur = parent
  }
  return false
}

/** Every doc-store content id a page owns: the node id itself plus the
 *  satellite canvases it spawns (doc sheets and pptx slides share `docPages`;
 *  a pdf has per-page notes AND per-page ink; image/web have one overlay
 *  each). Anything missing here would keep syncing after the user turned the
 *  page off — or leak on delete, which is why removeNode uses this too. */
export function contentIdsOf(page: PageNode): string[] {
  return [
    page.id,
    ...(page.docPages ?? []),
    ...(page.notesPages ?? []),
    ...(page.annotPages ?? []),
    ...(page.notesDocId ? [page.notesDocId] : []),
    ...(page.imageAnnotPageId ? [page.imageAnnotPageId] : []),
    ...(page.webAnnotPageId ? [page.webAnnotPageId] : []),
  ].filter(Boolean)
}

const opfsId = (url: string | undefined): string | null =>
  typeof url === 'string' && url.startsWith('opfs:') ? url.slice('opfs:'.length) : null

/** Every file id a page's bytes live under: its source upload (`fileUrl` on a
 *  pdf/image/xlsx/pptx page) plus every embedded picture inside any of its
 *  content canvases. Reads through the archive for pages not in memory. */
export function fileIdsOf(page: PageNode): string[] {
  const source = opfsId(page.fileUrl)
  const docStore = useDocStore.getState()
  const embedded = contentIdsOf(page).flatMap((cid) => docStore.collectPageOpfsRefs(cid))
  return [...new Set([...(source ? [source] : []), ...embedded])]
}

const syncedPages = (nodes: Record<string, Node>): PageNode[] =>
  Object.values(nodes).filter(
    (n): n is PageNode =>
      n.kind === 'page' &&
      (n.syncEnabled === true ||
        globalPrefAllowsPage(n.pageKind) ||
        ancestorFolderSynced(nodes, n.id))
  )

/** Content ids cloud.ts is allowed to push, from the current tree. */
export function syncedContentIds(nodes: Record<string, Node>): Set<string> {
  return new Set(syncedPages(nodes).flatMap(contentIdsOf))
}

/** File ids device-file-sync.ts is allowed to upload *because a synced page
 *  references them* — unioned there with each file's own opt-in flag. */
export function syncedFileIds(nodes: Record<string, Node>): Set<string> {
  return new Set(syncedPages(nodes).flatMap(fileIdsOf))
}

/**
 * Flip a page's opt-in.
 *
 * Turning it OFF also removes what already reached the cloud — the content
 * rows and the images' blobs — because leaving copies up there after the user
 * said "stop syncing this" would make the toggle a lie. Nothing local is
 * touched: this is a sync setting, not a delete. (Same contract as
 * manager.ts's setSyncEnabled for a single file.)
 */
export async function setPageSyncEnabled(pageId: string, enabled: boolean): Promise<void> {
  const { useWorkspaceStore } = await import('@/lib/store/workspace')
  const node = useWorkspaceStore.getState().nodes[pageId]
  if (!node || node.kind !== 'page') return
  useWorkspaceStore.getState().updatePageMeta(pageId, { syncEnabled: enabled })
  if (enabled) return

  // Reuse the ordinary deletion queue — cloud.ts drains it on its next flush
  // and DELETEs those simblip_pages rows, exactly as a real page delete does.
  contentIdsOf(node).forEach(markPageDeleted)

  const files = fileIdsOf(node)
  if (files.length === 0) return
  const { setSyncEnabled } = await import('@/lib/storage/manager')
  // Sequential on purpose: each call issues a DELETE to /api/storage, and a
  // page can reference dozens of images.
  for (const id of files) await setSyncEnabled(id, false)
}

/**
 * Flip a folder's opt-in, cascading to every descendant page and file.
 *
 * Turning it ON makes all pages and files inside the folder eligible for sync
 * without requiring individual toggles. Turning it OFF removes cloud copies of
 * all descendant content (same contract as the per-page toggle).
 */
export async function setFolderSyncEnabled(folderId: string, enabled: boolean): Promise<void> {
  const { useWorkspaceStore, descendantsOf } = await import('@/lib/store/workspace')
  const nodes = useWorkspaceStore.getState().nodes
  const node = nodes[folderId]
  if (!node || node.kind !== 'folder') return

  useWorkspaceStore.setState((s) => ({
    nodes: { ...s.nodes, [folderId]: { ...s.nodes[folderId], syncEnabled: enabled } as Node },
  }))

  if (enabled) return

  const descendants = descendantsOf(nodes, folderId)
  for (const desc of descendants) {
    if (desc.kind === 'page' && desc.syncEnabled !== true) {
      contentIdsOf(desc).forEach(markPageDeleted)
      const files = fileIdsOf(desc)
      if (files.length > 0) {
        const { setSyncEnabled } = await import('@/lib/storage/manager')
        for (const id of files) await setSyncEnabled(id, false)
      }
    }
  }
}
