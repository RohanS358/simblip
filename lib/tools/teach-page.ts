'use client'

// teach.page — "teach me whatever is in this page": read the open page and walk the student through all of it.
// Boards, documents and slide decks. The explanation is grounded in what is on the page (lib/lesson/page-lesson.ts).

import { z } from 'zod'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { startTour } from '@/lib/lesson/controller'
import { cancelPreparing, directorParts, progressPreparing, startPreparing } from '@/lib/lesson/generate'
import { explainItems, illustrate, pageStoryboard } from '@/lib/lesson/page-lesson'
import { readPage, type PageReading } from '@/lib/lesson/page-read'
import { readPdf } from '@/lib/lesson/pdf-read'
import { useLesson } from '@/lib/lesson/store'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'

const READABLE = new Set(['board', 'doc', 'pptx', 'pdf'])

export const teachPage = registerTool(
  defineTool({
    name: 'teach.page',
    summary: 'Read the open page or document and teach everything in it, with pictures and simulations',
    help: 'Walks through every note, formula, table, graph, simulation and block of text on the open board, document, slide deck or PDF, in reading order, explaining each in detail and drawing a diagram or simulation beside it onto the page. Pass brief to keep it to the point.',
    effect: 'run',
    keywords: ['teach me this page', 'explain this page', 'whatever is in this page', 'walk me through this page'],
    input: z.object({ brief: z.boolean().optional() }),
    async run({ brief = false }) {
      const ws = useWorkspaceStore.getState()
      const nodeId = ws.activePageId
      const node = nodeId ? ws.nodes[nodeId] : undefined
      if (!nodeId || !node) return fail('Open a page first.')
      const kind = (node as { pageKind?: string }).pageKind ?? 'board'
      if (!READABLE.has(kind)) return fail(`I can read boards, documents and slide decks so far — this is a ${kind} page.`)

      let reading: PageReading
      const sheetIds = kind === 'board' ? [nodeId] : ((node as { docPages?: string[] }).docPages ?? [])
      if (kind === 'pdf') {
        reading = { title: node.name, kind, items: await readPdf(nodeId) }
      } else {
        const docs = useDocStore.getState()
        for (const id of [nodeId, ...sheetIds]) docs.loadPage(id) // sheets that were never opened are not in memory yet
        const sheets = sheetIds.flatMap((id) => (useDocStore.getState().pages[id] ? [{ pageId: id, doc: useDocStore.getState().pages[id] }] : []))
        reading = readPage({ title: node.name, kind, sheets, flow: useDocStore.getState().pages[nodeId]?.flow, flowPageId: sheetIds[0] ?? nodeId })
      }
      if (!reading.items.length) return fail('This page is empty — there is nothing to teach yet.')

      const lessonPage = kind === 'board' || kind === 'pdf' ? nodeId : (ws.activeSheetId ?? sheetIds[0] ?? nodeId)
      // Phrasing the explanations takes a model call or two: build in the background, with progress and a Cancel.
      void (async () => {
        const ac = startPreparing(node.name, `Reading ${reading.items.length} things on the page…`)
        try {
          const { llm, runner } = directorParts()
          const pictures = new Map<number, string>()
          const explanations = await explainItems(llm, reading.items, ac.signal, { brief, pictures, onProgress: (done, total) => progressPreparing(node.name, `Preparing the explanation… ${done} of ${total}`) })
          if (ac.signal.aborted) return
          const drawn = await illustrate({ llm, runner, signal: ac.signal, onProgress: (m) => progressPreparing(node.name, m) }, pictures)
          if (ac.signal.aborted) return
          progressPreparing(node.name, 'Getting ready…')
          const sb = pageStoryboard(reading, explanations, drawn, { brief })
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
