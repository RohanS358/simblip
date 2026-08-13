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
 *  .docx opens as a 'pdf' page. It used to open as a 'doc' page, parsed by
 *  lib/store/docx-import.ts — but that importer only lifts paragraph TEXT out
 *  of word/document.xml: styling, tables, images, headers/footers and columns
 *  are all dropped, and its page breaks are a hard every-20-paragraphs chunk
 *  rather than Word's real ones. Routing through to-pdf.ts's docx-preview
 *  render instead gives a faithful document you can read and annotate, at the
 *  cost of editing it as scene objects. The conversion itself happens on
 *  first open in pdf-view.tsx, so it covers every entry point (file rows,
 *  canvas drops, the add-page dialog, the uploads panel) rather than each
 *  caller remembering to do it.
 *
 *  docx-import.ts and its docx-export.ts inverse are still wired to the 'doc'
 *  kind and still used by Document's own "Export .docx" — this only changes
 *  what an IMPORTED .docx becomes. */
export function pageKindForFile(node: Pick<FileNode, 'mime' | 'name'>): PageKind | null {
  const ext = node.name.slice(node.name.lastIndexOf('.')).toLowerCase()
  if (IMAGE_TYPES.has(node.mime) || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) return 'image'
  if (node.mime === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (DOCX_TYPES.has(node.mime) || ext === '.docx') return 'pdf'
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
