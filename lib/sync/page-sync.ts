'use client'

// Per-page / per-folder cloud sync MODE.
//
// Three modes, resolved per page (see syncModeOf):
//
//   'auto'  (default) — the page's CONTENT syncs automatically: board objects,
//           document text, slide objects, annotations, every satellite canvas.
//           This is small, essential data and follows the user everywhere
//           without anyone switching anything on. The BYTES of large source
//           files the page uses (an uploaded PDF, PPTX, image) stay on the
//           device that has them — they cost real storage in the 150 MB
//           project quota, so they only upload when asked.
//   'full'  — content AND the page's files sync ("Sync with files").
//   'local' — nothing leaves this device ("Keep on this device only"). The
//           tree node still travels (so no device loses the tree), but the
//           page is hidden on every other device — see stampSyncedContent and
//           splitPulledTree in lib/sync/tree-visibility.ts.
//
// Storage: `PageNode.syncEnabled` / `FolderNode.syncEnabled` —
//   undefined → inherit (nearest folder that sets one, else global prefs,
//   else 'auto'), true → 'full', false → 'local'.
//
// Images are DERIVED, not copied: a page's file ids are recomputed from the
// live tree + page content on every push, so an image dropped onto a 'full'
// page after the toggle is covered automatically. The per-file flag still
// works on its own — the two are OR'd.

// NOTE: the workspace store is imported dynamically inside setPageSyncEnabled,
// not at module scope — workspace.ts imports contentIdsOf from here for its own
// delete path, and a static import back would close the cycle.
import { useDocStore } from '@/lib/store/document'
import { markPageDeleted } from '@/lib/store/deleted-pages'
import type { FolderNode, Node, PageNode } from '@/lib/scene/types'
import { globalPrefAllowsPage } from '@/lib/sync/sync-prefs'

export type SyncMode = 'auto' | 'full' | 'local'

const modeOfFlag = (flag: boolean | undefined): SyncMode | null =>
  flag === true ? 'full' : flag === false ? 'local' : null

/** The page's effective sync mode: its own flag, else the nearest ancestor
 *  folder that sets one, else the device's global category prefs, else auto. */
export function syncModeOf(nodes: Record<string, Node>, page: PageNode): SyncMode {
  const own = modeOfFlag(page.syncEnabled)
  if (own) return own
  let cur: Node | undefined = page
  while (cur?.parentId) {
    const parent: Node | undefined = nodes[cur.parentId]
    if (parent?.kind === 'folder') {
      const m = modeOfFlag((parent as FolderNode).syncEnabled)
      if (m) return m
    }
    cur = parent
  }
  return globalPrefAllowsPage(page.pageKind) ? 'full' : 'auto'
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

const pagesIn = (nodes: Record<string, Node>, keep: (m: SyncMode) => boolean): PageNode[] =>
  Object.values(nodes).filter((n): n is PageNode => n.kind === 'page' && keep(syncModeOf(nodes, n)))

/** Content ids cloud.ts is allowed to push, from the current tree: every page
 *  not explicitly kept local. */
export function syncedContentIds(nodes: Record<string, Node>): Set<string> {
  return new Set(pagesIn(nodes, (m) => m !== 'local').flatMap(contentIdsOf))
}

/** File ids device-file-sync.ts is allowed to upload *because a 'full' page
 *  references them* — unioned there with each file's own opt-in flag. */
export function syncedFileIds(nodes: Record<string, Node>): Set<string> {
  return new Set(pagesIn(nodes, (m) => m === 'full').flatMap(fileIdsOf))
}

const flagOf = (mode: SyncMode | 'inherit'): boolean | undefined =>
  mode === 'full' ? true : mode === 'local' ? false : undefined

/** Remove what a page no longer allows from the cloud — content rows when it
 *  went local, file bytes when it left 'full'. Nothing local is touched. */
async function retract(page: PageNode, from: SyncMode, to: SyncMode): Promise<void> {
  if (to === 'local' && from !== 'local') contentIdsOf(page).forEach(markPageDeleted)
  if (from === 'full' && to !== 'full') {
    const files = fileIdsOf(page)
    if (files.length === 0) return
    const { setSyncEnabled, isSyncEnabled } = await import('@/lib/storage/manager')
    // Sequential on purpose: each call may DELETE from /api/storage. A file
    // the user opted in on its own keeps its cloud copy.
    for (const id of files) if (!(await isSyncEnabled(id))) await setSyncEnabled(id, false)
  }
}

/**
 * Set a page's sync mode ('inherit' clears its own flag).
 *
 * Moving to a narrower mode removes what already reached the cloud — leaving
 * copies up there after the user said "keep this local" would make the
 * setting a lie. Nothing local is ever touched: this is a sync setting, not a
 * delete.
 */
export async function setPageSyncMode(pageId: string, mode: SyncMode | 'inherit'): Promise<void> {
  const { useWorkspaceStore } = await import('@/lib/store/workspace')
  const nodes = useWorkspaceStore.getState().nodes
  const node = nodes[pageId]
  if (!node || node.kind !== 'page') return
  const before = syncModeOf(nodes, node)
  useWorkspaceStore.getState().updatePageMeta(pageId, { syncEnabled: flagOf(mode) })
  const after = syncModeOf(useWorkspaceStore.getState().nodes, useWorkspaceStore.getState().nodes[pageId] as PageNode)
  await retract(node, before, after)
}

/** Set a folder's sync mode; descendants without their own flag inherit it. */
export async function setFolderSyncMode(folderId: string, mode: SyncMode | 'inherit'): Promise<void> {
  const { useWorkspaceStore, descendantsOf } = await import('@/lib/store/workspace')
  const nodes = useWorkspaceStore.getState().nodes
  const node = nodes[folderId]
  if (!node || node.kind !== 'folder') return
  const pages = descendantsOf(nodes, folderId).filter((d): d is PageNode => d.kind === 'page')
  const before = new Map(pages.map((p) => [p.id, syncModeOf(nodes, p)]))
  useWorkspaceStore.setState((s) => ({
    nodes: { ...s.nodes, [folderId]: { ...s.nodes[folderId], syncEnabled: flagOf(mode) } as Node },
  }))
  const next = useWorkspaceStore.getState().nodes
  for (const p of pages) await retract(p, before.get(p.id)!, syncModeOf(next, p))
}

/** Back-compat wrappers for the old boolean switch: on → 'full', off → 'auto'. */
export const setPageSyncEnabled = (pageId: string, enabled: boolean) =>
  setPageSyncMode(pageId, enabled ? 'full' : 'inherit')
export const setFolderSyncEnabled = (folderId: string, enabled: boolean) =>
  setFolderSyncMode(folderId, enabled ? 'full' : 'inherit')

// ── Cross-device visibility ─────────────────────────────────────────────────

/**
 * Stamp `syncedContent` onto a COPY of the tree, for pushing to the cloud.
 *
 * The receiving device can't recompute the opt-in itself: `globalPrefAllowsPage`
 * reads per-device prefs, so device B would get a different answer than device A
 * for the same page. The pusher resolves all three tiers once, here, and records
 * the verdict on the wire so every puller agrees.
 */
export function stampSyncedContent(nodes: Record<string, Node>): Record<string, Node> {
  const allowed = syncedContentIds(nodes)
  return Object.fromEntries(
    Object.entries(nodes).map(([id, n]) =>
      n.kind === 'page' ? [id, { ...n, syncedContent: allowed.has(id) }] : [id, n]
    )
  )
}

/** Effective mode for pages created inside a folder (its own flag, else its
 *  ancestors', else the default) — what the folder menu shows. */
export function folderSyncMode(nodes: Record<string, Node>, folderId: string): SyncMode {
  return syncModeOf(nodes, { id: '', kind: 'page', parentId: folderId, name: '', order: 0 } as unknown as PageNode)
}
