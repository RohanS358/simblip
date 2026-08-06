'use client'

// One-time migration from the old fixed 2-level tree (Notebook[] -> Section[]
// -> PageMeta[]) to the new arbitrary-depth Node tree (Record<string, Node>).
// Detected by shape (old data is an array, new data is a plain object), same
// "check the actual field, not a version flag" style lib/store/document.ts's
// own onRehydrateStorage migration already uses.
//
// This function must be a plain, importable function — not buried inside a
// zustand persist config — because there are TWO places a workspace tree
// lands in memory: the normal rehydrate-from-localStorage path (synchronous,
// via onRehydrateStorage) and a cloud pull's `setState({ nodes: ... })`
// (lib/sync/cloud.ts's reconcile(), which bypasses the persist lifecycle
// entirely). Both call sites need the same migration.

import type { FolderNode, Node, PageKind } from '@/lib/scene/types'

interface LegacyPageMeta {
  id: string
  name: string
  kind?: PageKind
  docPages?: string[]
  sheetSizes?: Record<string, { w: number; h: number }>
  docPageSize?: { w: number; h: number }
  docSubtitle?: string
  docDate?: string
  notesPages?: string[]
  annotPages?: string[]
  notesDocId?: string
  fileUrl?: string
  fileName?: string
  fileMime?: string
}
interface LegacySection {
  id: string
  name: string
  color: string
  pages: LegacyPageMeta[]
}
interface LegacyNotebook {
  id: string
  name: string
  emoji: string
  cover?: string
  sections: LegacySection[]
}

/** Old shape: Notebook[]. New shape: Record<string, Node>. Returns null if
 *  `input` isn't the old array shape (already migrated, or empty/absent). */
export function migrateNotebooksToNodes(input: unknown): Record<string, Node> | null {
  if (!Array.isArray(input)) return null
  const notebooks = input as LegacyNotebook[]
  const nodes: Record<string, Node> = {}
  let order = 0
  for (const nb of notebooks) {
    const folder: FolderNode = {
      id: nb.id,
      parentId: null,
      kind: 'folder',
      name: nb.name,
      emoji: nb.emoji,
      cover: nb.cover,
      order: order++,
    }
    nodes[nb.id] = folder
    let secOrder = 0
    for (const sec of nb.sections) {
      const sectionFolder: FolderNode = {
        id: sec.id,
        parentId: nb.id,
        kind: 'folder',
        name: sec.name,
        color: sec.color,
        order: secOrder++,
      }
      nodes[sec.id] = sectionFolder
      let pageOrder = 0
      for (const p of sec.pages) {
        const { id, name, kind, ...rest } = p
        nodes[id] = { id, parentId: sec.id, kind: 'page', name, pageKind: kind, order: pageOrder++, ...rest }
      }
    }
  }
  return nodes
}
