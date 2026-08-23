'use client'

// Storage garbage collector — one-shot sweep that finds OPFS blobs which no
// longer have a live reference anywhere in the workspace tree or page archive,
// then deletes them. Run this on startup or from the DEV console.
//
// Three sources of live references are checked:
//   1. FileNode.fileId   — raw uploaded file nodes in the workspace tree
//   2. PageNode.fileUrl  — 'opfs:<id>' source file attached to a pptx/pdf/image page
//   3. SceneObject.geometry.src — 'opfs:<id>' embedded picture objects inside pages

import * as opfs from './opfs'
import * as manifest from './manifest'
import { deleteFiles } from './manager'

/** Collect every `opfs:<id>` file-ID that is still referenced somewhere in the
 *  workspace tree (FileNode.fileId and PageNode.fileUrl). */
function collectTreeRefs(nodes: Record<string, import('@/lib/scene/types').Node>): Set<string> {
  const live = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (node.kind === 'file') {
      live.add(node.fileId)
    } else if (node.kind === 'page') {
      const fileUrl = node.fileUrl
      if (typeof fileUrl === 'string' && fileUrl.startsWith('opfs:')) {
        live.add(fileUrl.slice('opfs:'.length))
      }
    }
  }
  return live
}

/** Collect every `opfs:<id>` file-ID referenced by picture objects inside all
 *  pages that are archived to localStorage (and optionally in-memory pages). */
function collectPageRefs(): Set<string> {
  const live = new Set<string>()
  const { archivedPageIds, readPage } = require('@/lib/store/page-archive') as typeof import('@/lib/store/page-archive')
  for (const pageId of archivedPageIds()) {
    const content = readPage(pageId)
    if (!content) continue
    for (const obj of Object.values(content.objects)) {
      const src = obj.geometry?.src
      if (typeof src === 'string' && src.startsWith('opfs:')) {
        live.add(src.slice('opfs:'.length))
      }
    }
  }
  return live
}

/** Enumerate all file-IDs currently stored in the OPFS /simblip/<userId>/files/
 *  directory by walking the directory handle. */
async function listOpfsFileIds(): Promise<string[]> {
  if (!opfs.opfsSupported()) return []
  try {
    const root = await navigator.storage.getDirectory()
    const simblipDir = await root.getDirectoryHandle('simblip').catch(() => null)
    if (!simblipDir) return []
    const ids: string[] = []
    // Walk all user subdirs
    for await (const [, userHandle] of simblipDir as unknown as AsyncIterable<[string, FileSystemDirectoryHandle]>) {
      if (userHandle.kind !== 'directory') continue
      const filesHandle = await (userHandle as FileSystemDirectoryHandle).getDirectoryHandle('files').catch(() => null)
      if (!filesHandle) continue
      for await (const [name] of filesHandle as unknown as AsyncIterable<[string, unknown]>) {
        ids.push(name)
      }
    }
    return ids
  } catch {
    return []
  }
}

export interface GcResult {
  /** Number of OPFS files found. */
  total: number
  /** Number of files deleted as orphans. */
  deleted: number
  /** IDs of deleted files. */
  deletedIds: string[]
}

/**
 * Run a full storage garbage-collection sweep:
 * 1. Enumerate all OPFS file IDs on disk.
 * 2. Collect all live references from the workspace tree + page archive.
 * 3. Delete any file whose ID is not referenced anywhere.
 *
 * This is safe to call at any time — it only deletes files with zero live
 * references. The caller should pass the current workspace `nodes` map so
 * tree refs are scanned correctly.
 */
export async function runStorageGc(
  nodes: Record<string, import('@/lib/scene/types').Node>
): Promise<GcResult> {
  const [opfsIds] = await Promise.all([listOpfsFileIds()])
  if (opfsIds.length === 0) return { total: 0, deleted: 0, deletedIds: [] }

  // Gather all in-memory page refs from the doc store too
  const { useDocStore } = await import('@/lib/store/document')
  const docStore = useDocStore.getState()
  const inMemoryPageIds = Object.keys(docStore.pages ?? {})

  const treeRefs = collectTreeRefs(nodes)
  const archiveRefs = collectPageRefs()
  // Images pasted into the Note Gallery live in OPFS by id like any upload,
  // but hang off no tree node and no page — without this they read as
  // orphans and a sweep would wipe the user's scrapbook.
  const { galleryOpfsRefs } = await import('@/lib/store/notes-gallery')
  const galleryRefs = new Set(galleryOpfsRefs())
  const inMemoryRefs = new Set<string>(
    inMemoryPageIds.flatMap((pid) => docStore.collectPageOpfsRefs(pid))
  )

  // Also collect IDs of files that are in the manifest and have a cloud copy —
  // never GC cloud-backed files (they may be in transit or needed on other devices)
  const allEntries = await manifest.listAllEntries()
  const cloudRefs = new Set<string>(
    allEntries.filter((e) => e.cloudBackedUp && e.cloudUrl).map((e) => e.id)
  )

  const live = new Set([...treeRefs, ...archiveRefs, ...inMemoryRefs, ...cloudRefs, ...galleryRefs])
  const orphans = opfsIds.filter((id) => !live.has(id))

  if (orphans.length > 0) {
    await deleteFiles(orphans)
  }

  return { total: opfsIds.length, deleted: orphans.length, deletedIds: orphans }
}
