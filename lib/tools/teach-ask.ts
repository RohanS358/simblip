'use client'

// teach.ask — a question asked with the teacher switched on in the assistant: the open page is read and the teacher answers
// the question as a short, drawn, narrated lesson that refers to what is on the page. Works on any page — an empty or
// unreadable one just means the answer comes from the question alone.

import { z } from 'zod'
import { teachMaterial } from '@/lib/lesson/generate'
import { readOpenPage } from '@/lib/lesson/open-page'
import { briefPage, type BriefItem } from '@/lib/ai/brief/page-brief'
import { summaryFor } from '@/lib/ai/brief/summary'
import { READ_KINDS } from '@/lib/ai/panel-context'
import { useDocStore } from '@/lib/store/document'
import type { PageKind } from '@/lib/scene/types'
import { wantsBrief } from '@/lib/lesson/solve'
import { defineTool, ok } from './types'
import { registerTool } from './registry'

export const teachAsk = registerTool(
  defineTool({
    name: 'teach.ask',
    summary: 'Answer a question as a teacher, using the open page as context',
    help: 'Reads the page the student has open (notes, formulas, graphs, simulations, documents, slides, PDFs) and answers their question as a short narrated lesson at the board, drawing a diagram or simulation where it helps. Opens its own lesson page.',
    effect: 'run',
    keywords: ['ask the teacher', 'explain this to me', 'what does this mean'],
    input: z.object({ question: z.string().min(2).max(600) }),
    async run({ question }) {
      const page = await readOpenPage()
      // The page, told in words and cut to what THIS question needs (lib/ai/brief/page-brief.ts) — not the first 7,500 characters.
      const items: BriefItem[] | undefined =
        typeof page !== 'string' && READ_KINDS.has(page.kind as PageKind)
          ? page.reading.items.map((it) => ({ kind: it.kind, text: it.text, ids: it.ids, live: it.live, locator: it.pdfPage ? `p. ${it.pdfPage}` : undefined }))
          : undefined
      const text =
        typeof page === 'string' || !page.reading.items.length
          ? ''
          : briefPage({
              title: page.name,
              kind: page.kind,
              doc: useDocStore.getState().pages[page.lessonPage],
              items,
              question,
              budget: 7_500,
              summary: items ? summaryFor(items) : undefined,
            }).text
      const brief = wantsBrief(question)
      void teachMaterial({ text: text || `The student has no readable page open. Answer from general knowledge: ${question}`, request: question, mode: 'ask', brief })
      return ok(text ? 'Looking at your page and working out how to explain it — it starts in a moment.' : 'Working out how to explain that — it starts in a moment.', { pageRead: Boolean(text) })
    },
  })
)
