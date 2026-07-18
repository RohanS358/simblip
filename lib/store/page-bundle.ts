'use client'

// The portable page payload. A board is just its PageDoc — but a doc is its
// sheets, and a PDF is a file reference plus per-page ink. Everything that
// leaves the device (shares, assignments, submissions, board sessions,
// exports) goes through bundlePage(), which packs the page's KIND, its tree
// metadata and every dependent content page into one object.
//
// A PageBundle IS a valid PageDoc (the extra fields are optional), so every
// existing database row, column type and API keeps working — old payloads
// simply have no `bundle` and import as boards, exactly as before.

import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import * as archive from '@/lib/store/page-archive'
import type { PageDoc, PageKind, PageMeta } from '@/lib/scene/types'

export interface BundleMeta {
  kind: PageKind
  /** doc: ordered sheet ids (keys into `sheets`). */
  docPages?: string[]
  sheetSizes?: Record<string, { w: number; h: number }>
  /** pdf: per-PDF-page notes / on-page ink ids ('' = none yet). */
  notesPages?: string[]
  annotPages?: string[]
  notesDocId?: string
  fileUrl?: string
  fileName?: string
  fileMime?: string
}

export interface PageBundle extends PageDoc {
  bundle?: BundleMeta
  /** Content of every referenced sheet, keyed by its ORIGINAL id. */
  sheets?: Record<string, PageDoc>
}

const EMPTY: PageDoc = { objects: {}, variables: [] }

/** A content page wherever it currently lives: memory first, then archive. */
export function readContent(pageId: string): PageDoc {
  return useDocStore.getState().pages[pageId] ?? archive.readPage(pageId) ?? EMPTY
}

const sheetIdsOf = (meta: PageMeta): string[] => [
  ...(meta.docPages ?? []),
  ...(meta.notesPages ?? []).filter(Boolean),
  ...(meta.annotPages ?? []).filter(Boolean),
  ...(meta.notesDocId ? [meta.notesDocId] : []),
]

/** Pack a page (content + kind + dependent sheets) for transport. Ids are
 *  NOT remapped here — receivers that need fresh ids (shares, assignments)
 *  remap on import; mirrors and board sessions keep them for round-trips. */
export function bundlePage(pageId: string): PageBundle {
  const meta = findPageMeta(useWorkspaceStore.getState().notebooks, pageId)
  const content = readContent(pageId)
  const kind = meta?.kind ?? 'board'
  if (!meta || kind === 'board') return { ...content }

  const sheets: Record<string, PageDoc> = {}
  for (const id of sheetIdsOf(meta)) sheets[id] = readContent(id)
  return {
    ...content,
    bundle: {
      kind,
      docPages: meta.docPages,
      sheetSizes: meta.sheetSizes,
      notesPages: meta.notesPages,
      annotPages: meta.annotPages,
      notesDocId: meta.notesDocId,
      fileUrl: meta.fileUrl,
      fileName: meta.fileName,
      fileMime: meta.fileMime,
    },
    sheets,
  }
}

/** The PageMeta patch a bundle describes (ids kept as-is). */
export function bundleMetaPatch(b: BundleMeta): Partial<PageMeta> {
  return {
    kind: b.kind,
    docPages: b.docPages,
    sheetSizes: b.sheetSizes,
    notesPages: b.notesPages,
    annotPages: b.annotPages,
    notesDocId: b.notesDocId,
    fileUrl: b.fileUrl,
    fileName: b.fileName,
    fileMime: b.fileMime,
  }
}

/** Strip transport fields so the main content is a plain PageDoc again. */
export function stripBundle(b: PageBundle): PageDoc {
  return { objects: b.objects, variables: b.variables }
}

/** Write a bundle's content pages into the doc store under their ORIGINAL
 *  ids (mirror/session semantics — no remapping, idempotent overwrite). */
export function writeBundleContent(pageId: string, b: PageBundle): void {
  const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  useDocStore.setState((s) => {
    const pages = { ...s.pages, [pageId]: deep(stripBundle(b)) }
    const scopes = { ...s.scopes, [pageId]: undefined as never }
    for (const [id, doc] of Object.entries(b.sheets ?? {})) {
      pages[id] = deep(doc)
      scopes[id] = undefined as never
    }
    return { pages, scopes }
  })
  const doc = useDocStore.getState()
  doc.ensurePage(pageId)
  for (const id of Object.keys(b.sheets ?? {})) doc.ensurePage(id)
}

/** Every object in a bundle, main page and sheets together — for remotes and
 *  previews that want "what's on this page" regardless of kind. */
export function flattenBundleObjects(b: PageBundle): PageDoc['objects'] {
  const out = { ...b.objects }
  for (const doc of Object.values(b.sheets ?? {})) Object.assign(out, doc.objects)
  return out
}
