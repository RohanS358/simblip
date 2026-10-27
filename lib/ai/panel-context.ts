'use client'

// What the assistant is sent about the page the student is looking at. One builder, used both when a prompt is sent and by
// the context meter in the composer, so what the meter shows is exactly what leaves — never a second opinion of it.
//
// The page is not sent as objects. lib/ai/brief/page-brief.ts tells it as a person would — what it is about, what is on it by
// role, how the parts relate — and spends its character budget on what the QUESTION needs. A long document, deck or PDF is
// read once, split into passages and ranked against the question; only the best are sent whole.

import { useDocStore } from '@/lib/store/document'
import { findPageMeta, useWorkspaceStore } from '@/lib/store/workspace'
import { viewportBounds } from '@/lib/scene/insertables'
import { systemVariablesOf } from '@/lib/formula/system-scope'
import { describeSurface } from '@/lib/ai/page-context'
import { briefPage, type BriefItem } from '@/lib/ai/brief/page-brief'
import { summaryFor } from '@/lib/ai/brief/summary'
import { readOpenPage } from '@/lib/lesson/open-page'
import type { PageKind } from '@/lib/scene/types'

export interface PanelContext {
  /** The page, told in words (lib/ai/brief/page-brief.ts). */
  pageDigest: string
  /** The space to build into, with coordinates — for the lane that writes them. */
  pageSurface: string
  hasSelection: boolean
  pageLabel: string
  /** Ids and parameter NAMES only — enough to verify an edit plan server-side, without shipping the document itself. */
  pageObjects: Record<string, { kind: string; params: string[] }>
  /** id → what a person calls it. */
  pageNames: Record<string, string>
  stats: { items: number; shown: number; summarised: number; chars: number }
}

/** Kinds whose content is not the objects on the canvas: it is read out of the document. */
export const READ_KINDS = new Set<PageKind>(['doc', 'pptx', 'pdf'])

/** Read a document, deck or PDF into passages with locators. Async because a PDF is. */
export async function loadBriefItems(): Promise<BriefItem[] | undefined> {
  const page = await readOpenPage()
  if (typeof page === 'string') return undefined
  const slideOf = new Map(page.sheetIds.map((id, i) => [id, i + 1]))
  return page.reading.items.map((it) => ({
    kind: it.kind,
    text: it.text,
    ids: it.ids,
    live: it.live,
    locator: it.pdfPage ? `p. ${it.pdfPage}` : page.kind === 'pptx' && slideOf.get(it.pageId) ? `slide ${slideOf.get(it.pageId)}` : undefined,
  }))
}

export function buildPanelContext(pageId: string | null | undefined, pageKind: PageKind, question = '', items?: BriefItem[]): PanelContext | null {
  const page = pageId ? useDocStore.getState().pages[pageId] : undefined
  if (!page || !pageId) return null
  const sel = useDocStore.getState().selection
  const surface = describeSurface({ kind: pageKind, bounds: viewportBounds(pageId) }, page)
  const brief = briefPage({
    title: (() => { const ws = useWorkspaceStore.getState(); return findPageMeta(ws.nodes, ws.activePageId)?.name ?? 'this page' })(),
    kind: pageKind,
    doc: page,
    items: READ_KINDS.has(pageKind) ? items : undefined,
    selection: sel,
    question,
    budget: READ_KINDS.has(pageKind) ? 7_500 : undefined,
    summary: items ? summaryFor(items) : undefined,
  })
  if (!brief.text && !surface) return null
  return {
    pageDigest: brief.text,
    pageSurface: surface,
    hasSelection: sel.length > 0,
    pageLabel: sel.length > 0 ? `${sel.length} selected object(s)` : 'the page you are on',
    pageObjects: Object.fromEntries(Object.values(page.objects).map((o) => [o.id, { kind: o.geometry.kind, params: Object.keys(o.parameters) }])),
    pageNames: brief.names,
    stats: brief.stats,
  }
}

/** The page's variables, as sent alongside the digest. */
export function buildPageContext(pageId: string | null | undefined) {
  const page = pageId ? useDocStore.getState().pages[pageId] : undefined
  if (!page) return undefined
  return {
    variables: page.variables.map((v) => ({ name: v.name, expr: v.expr })),
    systemVariables: systemVariablesOf(page.objects),
    objectCount: Object.keys(page.objects).length,
  }
}
