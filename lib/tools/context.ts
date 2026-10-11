'use client'

// Which page a tool acts on — the CONTENT page (a slide, a doc sheet, a
// board), resolved the way the sidebar and dock resolve it. Same rule as
// contentPageIdFor in components/workspace/canvas-controls.tsx; repeated here
// because lib/ must not import a component file.

import { findPageMeta, useWorkspaceStore } from '@/lib/store/workspace'
import type { ToolContext } from './types'

const SHEET_KINDS = new Set(['doc', 'pptx', 'image', 'web', 'course'])

export function activeContext(signal?: AbortSignal): ToolContext {
  const s = useWorkspaceStore.getState()
  const kind = findPageMeta(s.nodes, s.activePageId)?.pageKind ?? 'board'
  const pageId = SHEET_KINDS.has(kind) || s.pdfToolsActive ? s.activeSheetId ?? s.activePageId : s.activePageId
  return { pageId, signal }
}
