'use client'

// The page the student is looking at, read into the shape the teacher works from (lib/lesson/page-read.ts).
// Shared by teach.page ("teach me this page") and teach.ask (a question asked with the teacher switched on).

import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { readPage, type PageReading } from './page-read'
import { readPdf } from './pdf-read'

export const READABLE = new Set(['board', 'doc', 'pptx', 'pdf'])

export interface OpenPage {
  nodeId: string
  name: string
  kind: string
  reading: PageReading
  /** The sheet a lesson about it is drawn beside. */
  lessonPage: string
  /** Sheets or slides, in order — to say "slide 3" rather than an id. */
  sheetIds: string[]
}

/** Read the open page. A string is the reason it cannot be read. */
export async function readOpenPage(): Promise<OpenPage | string> {
  const ws = useWorkspaceStore.getState()
  const nodeId = ws.activePageId
  const node = nodeId ? ws.nodes[nodeId] : undefined
  if (!nodeId || !node) return 'Open a page first.'
  const kind = (node as { pageKind?: string }).pageKind ?? 'board'
  if (!READABLE.has(kind)) return `I can read boards, documents and slide decks so far — this is a ${kind} page.`

  const sheetIds = kind === 'board' ? [nodeId] : ((node as { docPages?: string[] }).docPages ?? [])
  let reading: PageReading
  if (kind === 'pdf') {
    reading = { title: node.name, kind, items: await readPdf(nodeId) }
  } else {
    const docs = useDocStore.getState()
    for (const id of [nodeId, ...sheetIds]) docs.loadPage(id) // sheets that were never opened are not in memory yet
    const sheets = sheetIds.flatMap((id) => (useDocStore.getState().pages[id] ? [{ pageId: id, doc: useDocStore.getState().pages[id] }] : []))
    reading = readPage({ title: node.name, kind, sheets, flow: useDocStore.getState().pages[nodeId]?.flow, flowPageId: sheetIds[0] ?? nodeId })
  }
  const lessonPage = kind === 'board' || kind === 'pdf' ? nodeId : (ws.activeSheetId ?? sheetIds[0] ?? nodeId)
  return { nodeId, name: node.name, kind, reading, lessonPage, sheetIds }
}
