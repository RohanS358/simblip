'use client'

// What the assistant is sent about the page the student is looking at. One builder, used both when a prompt is sent and by
// the context meter in the composer, so what the meter shows is exactly what leaves — never a second opinion of it.

import { useDocStore } from '@/lib/store/document'
import { viewportBounds } from '@/lib/scene/insertables'
import { systemVariablesOf } from '@/lib/formula/system-scope'
import { buildDigest, describeSurface } from '@/lib/ai/page-context'
import type { PageKind } from '@/lib/scene/types'

export interface PanelContext {
  pageDigest: string
  pageSurface: string
  hasSelection: boolean
  pageLabel: string
  /** Ids and parameter NAMES only — enough to verify an edit plan server-side, without shipping the document itself. */
  pageObjects: Record<string, { kind: string; params: string[] }>
}

export function buildPanelContext(pageId: string | null | undefined, pageKind: PageKind): PanelContext | null {
  const page = pageId ? useDocStore.getState().pages[pageId] : undefined
  if (!page || !pageId) return null
  const sel = useDocStore.getState().selection
  const digest = buildDigest(page, sel)
  // The space to work in, even when the page is empty — an empty board still has a viewport, and that is exactly when
  // knowing it matters most.
  const surface = describeSurface({ kind: pageKind, bounds: viewportBounds(pageId) }, page)
  if (!digest.text && !surface) return null
  return {
    pageDigest: digest.text,
    pageSurface: surface,
    hasSelection: sel.length > 0,
    pageLabel: sel.length > 0 ? `${sel.length} selected object(s)` : 'the page you are on',
    pageObjects: Object.fromEntries(Object.values(page.objects).map((o) => [o.id, { kind: o.geometry.kind, params: Object.keys(o.parameters) }])),
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
