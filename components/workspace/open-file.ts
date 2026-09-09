'use client'

// The FileNode -> viewer/editor Page bridge. A raw uploaded file (FileNode)
// has no renderer of its own — opening one lazily creates a companion Page
// of the right kind (mirroring lib/store/pdf-attach.ts's upload -> pdf-kind
// page flow) and links it back via FileNode.pageId, so later opens reuse the
// same page instead of re-importing. Shared by desktop's FileRow and
// mobile-shell's file card so both open files the same way.

import type { FileNode, PageKind } from '@/lib/scene/types'
import { useWorkspaceStore, findNode } from '@/lib/store/workspace'

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml'])

const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const XLSX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])
const PPTX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/** Resolve a FileNode's mime (falling back to its extension, since browsers
 *  don't always set a mime type on drag-drop/picker uploads) to the PageKind
 *  that can render it — null for anything with no viewer yet.
 *
 *  .docx opens as a 'doc' page again. It was routed to 'pdf' (a rasterized
 *  docx-preview render) because the old importer only lifted paragraph TEXT
 *  out of word/document.xml and chunked it onto sheets twenty paragraphs at a
 *  time — styling, lists, tables, images and the file's real page breaks were
 *  all lost, so a picture of the document beat a mangled copy of it.
 *
 *  That is no longer the trade: lib/store/docx-map.ts maps the file
 *  structurally into a doc page's flowing body — paragraph, run, list, table,
 *  image, page break, section — and our own layout engine repaginates it. The
 *  result is an editable document rather than an image of one. If the mapping
 *  throws, doc-view.tsx falls back and the reader still opens.
 *
 *  The docx-preview → PDF path in to-pdf.ts stays for that fallback and for
 *  anything else that needs a rasterized Word render. */
export function pageKindForFile(node: Pick<FileNode, 'mime' | 'name'>): PageKind | null {
  const ext = node.name.slice(node.name.lastIndexOf('.')).toLowerCase()
  if (IMAGE_TYPES.has(node.mime) || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) return 'image'
  if (node.mime === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (DOCX_TYPES.has(node.mime) || ext === '.docx') return 'doc'
  if (XLSX_TYPES.has(node.mime) || ext === '.xlsx') return 'xlsx'
  if (PPTX_TYPES.has(node.mime) || ext === '.pptx') return 'pptx'
  return null
}

/** Open a FileNode as a tab: reuse its companion page if one already exists,
 *  otherwise create one (seeded from the file's own bytes via fileUrl —
 *  each viewer resolves `opfs:<fileId>` itself, same as pdf-view.tsx does)
 *  and link it back onto the FileNode. No-ops (returns null) for a mime type
 *  with no viewer — callers should leave the row inert in that case. */
export function openFile(node: FileNode): string | null {
  const store = useWorkspaceStore
  const existing = node.pageId ? findNode(store.getState().nodes, node.pageId) : null
  if (existing?.kind === 'page') {
    store.getState().setActivePage(existing.id)
    return existing.id
  }

  const kind = pageKindForFile(node)
  if (!kind) return null

  const name = node.name.replace(/\.[^.]+$/, '')
  const pageId = store.getState().addPageIn(node.parentId ?? '', name, kind)
  store.getState().updatePageMeta(pageId, {
    fileUrl: `opfs:${node.fileId}`,
    fileName: node.name,
    fileMime: node.mime,
  })
  store.getState().setFilePageId(node.id, pageId)
  store.getState().setActivePage(pageId)
  return pageId
}
