'use client'

// teach.ask — a question asked with the teacher switched on in the assistant: the open page is read and the teacher answers
// the question as a short, drawn, narrated lesson that refers to what is on the page. Works on any page — an empty or
// unreadable one just means the answer comes from the question alone.

import { z } from 'zod'
import { teachMaterial } from '@/lib/lesson/generate'
import { readOpenPage } from '@/lib/lesson/open-page'
import { wantsBrief } from '@/lib/lesson/solve'
import { defineTool, ok } from './types'
import { registerTool } from './registry'

/** The page as plain lines for the model, most useful first, capped well under the planner's input budget. */
function pageText(name: string, items: { kind: string; text: string }[]): string {
  const lines = items.map((it) => `[${it.kind}] ${it.text}`.replace(/\s+/g, ' ').trim())
  return `Page: ${name}\n${lines.join('\n')}`.slice(0, 7500)
}

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
      const text = typeof page === 'string' || !page.reading.items.length ? '' : pageText(page.name, page.reading.items)
      const brief = wantsBrief(question)
      void teachMaterial({ text: text || `The student has no readable page open. Answer from general knowledge: ${question}`, request: question, mode: 'ask', brief })
      return ok(text ? 'Looking at your page and working out how to explain it — it starts in a moment.' : 'Working out how to explain that — it starts in a moment.', { pageRead: Boolean(text) })
    },
  })
)
