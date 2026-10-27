'use client'

// teach.page — "teach me whatever is in this page": read the open page and walk the student through all of it.
// Boards, documents and slide decks. The explanation is grounded in what is on the page (lib/lesson/page-lesson.ts).

import { z } from 'zod'
import { startTour } from '@/lib/lesson/controller'
import { cancelPreparing, directorParts, progressPreparing, startPreparing } from '@/lib/lesson/generate'
import { explainItems, illustrate, pageStoryboard } from '@/lib/lesson/page-lesson'
import { readOpenPage } from '@/lib/lesson/open-page'
import { useLesson } from '@/lib/lesson/store'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'

export const teachPage = registerTool(
  defineTool({
    name: 'teach.page',
    summary: 'Read the open page or document and teach everything in it, with pictures and simulations',
    help: 'Walks through every note, formula, table, graph, simulation and block of text on the open board, document, slide deck or PDF, in reading order, explaining each in detail and drawing a diagram or simulation beside it onto the page. Pass brief to keep it to the point.',
    effect: 'run',
    keywords: ['teach me this page', 'explain this page', 'whatever is in this page', 'walk me through this page'],
    input: z.object({ brief: z.boolean().optional() }),
    async run({ brief = false }) {
      const page = await readOpenPage()
      if (typeof page === 'string') return fail(page)
      const { reading, lessonPage } = page
      const node = { name: page.name }
      if (!reading.items.length) return fail('This page is empty — there is nothing to teach yet.')

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
      return ok(`I'm reading “${node.name}”. There ${reading.items.length === 1 ? 'is 1 thing' : `are ${reading.items.length} things`} on it to go through, and the lesson starts in a moment.`, { items: reading.items.length })
    },
  })
)
