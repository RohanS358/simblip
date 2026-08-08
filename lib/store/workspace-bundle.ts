'use client'

// Whole-workspace backup payload — everything a full local snapshot/restore
// needs: the tree, every page's content, xlsx grids, and every locally
// stored file's bytes. Builds on lib/store/page-bundle.ts's per-page
// bundling rather than re-walking sheet/notes/annot enumeration itself.
//
// Not a sync payload — ids are kept as-is and the whole thing is meant to be
// written back onto the SAME account it came from (a new browser for the
// same user, or the same browser after a wipe), matching Settings' "Backup"
// tab. Files are base64 here (JSON-friendly); the zip layer
// (components/workspace/settings-dialog.tsx) stores them as raw zip entries
// instead — see exportWorkspaceZip/importWorkspaceZip below, which are the
// functions that tab actually calls.

import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { useFilePageContentStore } from '@/lib/store/file-page-content'
import { bundlePage, type PageBundle } from '@/lib/store/page-bundle'
import * as archive from '@/lib/store/page-archive'
import * as opfs from '@/lib/storage/opfs'
import * as manifest from '@/lib/storage/manifest'
import type { FileManifestEntry } from '@/lib/storage/manifest-types'
import type { Node } from '@/lib/scene/types'

export interface WorkspaceBundle {
  version: 1
  exportedAt: string
  nodes: Record<string, Node>
  /** Every PageNode's content, keyed by page id. */
  pages: Record<string, PageBundle>
  /** xlsx grid JSON, keyed by page id. */
  xlsxContent: Record<string, unknown>
  files: FileManifestEntry[]
}

/** Collect the tree + every page's content + xlsx grids + file metadata.
 *  File BYTES are handed back separately (fileId -> Blob) since a JSON
 *  object is the wrong shape for binary — the zip export writes them as
 *  sibling zip entries instead of inlining them here. */
export async function exportWorkspaceBundle(
  ownerId: string
): Promise<{ bundle: WorkspaceBundle; fileBlobs: Map<string, Blob> }> {
  const { nodes } = useWorkspaceStore.getState()

  const pages: Record<string, PageBundle> = {}
  for (const node of Object.values(nodes)) {
    if (node.kind === 'page') pages[node.id] = bundlePage(node.id)
  }

  const xlsxContent = { ...useFilePageContentStore.getState().content }

  const files = await manifest.listByOwner(ownerId)
  const fileBlobs = new Map<string, Blob>()
  for (const entry of files) {
    const blob = await opfs.readFile(entry.id)
    if (blob) fileBlobs.set(entry.id, blob)
  }

  return {
    bundle: { version: 1, exportedAt: new Date().toISOString(), nodes, pages, xlsxContent, files },
    fileBlobs,
  }
}

/** Write a previously exported bundle back into this browser, under the
 *  given owner id. Overwrites whatever already exists at each id
 *  (idempotent — re-importing the same backup twice is safe). */
export async function importWorkspaceBundle(
  ownerId: string,
  bundle: WorkspaceBundle,
  fileBlobs: Map<string, Blob>
): Promise<void> {
  useWorkspaceStore.setState({ nodes: bundle.nodes })

  for (const [pageId, pageBundle] of Object.entries(bundle.pages)) {
    archive.writePage(pageId, { objects: pageBundle.objects, variables: pageBundle.variables })
    for (const [sheetId, doc] of Object.entries(pageBundle.sheets ?? {})) archive.writePage(sheetId, doc)
  }
  // Drop anything currently resident in memory so the next open re-reads
  // the freshly restored archive instead of serving stale cached content.
  useDocStore.setState({ pages: {}, scopes: {} })

  useFilePageContentStore.setState((s) => ({ content: { ...s.content, ...bundle.xlsxContent } }))

  for (const entry of bundle.files) {
    const blob = fileBlobs.get(entry.id)
    if (!blob) continue
    await opfs.writeFile(entry.id, blob)
    await manifest.putEntry({ ...entry, ownerId, syncStatus: 'local-only', cloudBackedUp: false, cloudUrl: undefined })
  }
}
