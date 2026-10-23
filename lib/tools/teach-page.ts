'use client'

// teach.page — "teach me whatever is in this page": read the open page and walk the student through all of it.
// Boards, documents and slide decks. The explanation is grounded in what is on the page (lib/lesson/page-lesson.ts).

import { z } from 'zod'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { startTour } from '@/lib/lesson/controller'
import { progressPreparing, startPreparing, cancelPreparing } from '@/lib/lesson/generate'
import { makeLlm } from '@/lib/lesson/llm'
import { explainItems, pageStoryboard } from '@/lib/lesson/page-lesson'
import { readPage } from '@/lib/lesson/page-read'
import { useLesson } from '@/lib/lesson/store'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'

const READABLE = new Set(['board', 'doc', 'pptx'])

export const teachPage = registerTool(
  defineTool({
    name: 'teach.page',
    summary: 'Read the open page and teach everything on it',
    help: 'Walks through every note, formula, table, graph, simulation and block of text on the open board, document or slide deck, in reading order, explaining each. Adds nothing to the page.',
    effect: 'run',
    keywords: ['teach me this page', 'explain this page', 'whatever is in this page', 'walk me through this page'],
    input: z.object({}),
    async run() {
      const ws = useWorkspaceStore.getState()
      const nodeId = ws.activePageId
      const node = nodeId ? ws.nodes[nodeId] : undefined
      if (!nodeId || !node) return fail('Open a page first.')
      const kind = (node as { pageKind?: string }).pageKind ?? 'board'
      if (!READABLE.has(kind)) return fail(`I can read boards, documents and slide decks so far — this is a ${kind} page.`)

      const sheetIds = kind === 'board' ? [nodeId] : ((node as { docPages?: string[] }).docPages ?? [])
      const docs = useDocStore.getState()
      for (const id of [nodeId, ...sheetIds]) docs.loadPage(id) // sheets that were never opened are not in memory yet
      const sheets = sheetIds.flatMap((id) => (useDocStore.getState().pages[id] ? [{ pageId: id, doc: useDocStore.getState().pages[id] }] : []))
      const reading = readPage({ title: node.name, kind, sheets, flow: useDocStore.getState().pages[nodeId]?.flow, flowPageId: sheetIds[0] ?? nodeId })
      if (!reading.items.length) return fail('This page is empty — there is nothing to teach yet.')

      const lessonPage = kind === 'board' ? nodeId : (ws.activeSheetId ?? sheetIds[0] ?? nodeId)
      // Phrasing the explanations takes a model call or two: build in the background, with progress and a Cancel.
      void (async () => {
        const ac = startPreparing(node.name, `Reading ${reading.items.length} things on the page…`)
        try {
          const explanations = await explainItems(makeLlm(), reading.items, ac.signal)
          if (ac.signal.aborted) return
          progressPreparing(node.name, 'Getting ready…')
          const sb = pageStoryboard(reading, explanations)
          useLesson.getState().set({ preparing: null })
          void startTour(sb, lessonPage)
        } catch {
          if (!ac.signal.aborted) cancelPreparing()
        }
      })()
      return ok(`Reading "${node.name}" — ${reading.items.length} thing${reading.items.length === 1 ? '' : 's'} to go through. It starts in a moment.`, { items: reading.items.length })
    },
  })
)
