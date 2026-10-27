'use client'

// teach.material — "solve this" / "teach me this" for something the student BROUGHT: a screenshot of a question, a
// pasted problem, a PDF or Word file attached to the chat. Opens a lesson page and plays a drawn, narrated worked
// solution (or lecture) built from the material (lib/lesson/solve.ts). In-page teaching of the OPEN document is teach.page.

import { z } from 'zod'
import { teachMaterial } from '@/lib/lesson/generate'
import { isQuestion, wantsBrief } from '@/lib/lesson/solve'
import { defineTool, ok } from './types'
import { registerTool } from './registry'

export const teachMaterialTool = registerTool(
  defineTool({
    name: 'teach.material',
    summary: 'Solve a question or teach attached material, with diagrams and simulations',
    help: 'Takes the text of an attached file or photographed question. A question is solved step by step like a teacher at a board — drawing the situation (circuit, forces, cash-flow diagram…), working every calculation with the numbers checked — and notes or chapters are taught in full. Opens its own page.',
    effect: 'run',
    keywords: ['solve this', 'answer this question', 'teach me this', 'explain this file'],
    input: z.object({ text: z.string().min(8).max(40_000), request: z.string().max(600).optional(), mode: z.enum(['solve', 'teach']).optional() }),
    async run({ text, request = '', mode }) {
      const asked = /\b(solve|answer|calculate|compute|find|work out)\b/i.test(request)
      const lecture = /\b(teach|explain|lesson|walk|chapter|notes|summar)/i.test(request) && text.length > 1200
      const how = mode ?? (asked ? 'solve' : lecture ? 'teach' : isQuestion(text) ? 'solve' : 'teach')
      const brief = wantsBrief(request)
      void teachMaterial({ text, request, mode: how, brief })
      return ok(`${how === 'solve' ? "I'm working through this question step by step" : "I'm preparing a lesson from your material"}${brief ? ' (short version)' : ''}. It starts in a moment.`, { mode: how })
    },
  })
)
