// The AI contract. The AI is an assistant, not a dependency: it returns
// SimScript — the same text a user could type into the Code IDE by hand —
// and never touches the canvas itself. The editor verifies and executes
// (docs/architecture.md).
//
// This used to carry a whole `SimulationPayload` JSON schema describing
// objects, behaviors and geometry. That was a THIRD hand-maintained copy of
// "what is placeable" (alongside lib/ai/tools.ts and lib/scene/factory.ts),
// and it had already drifted: it supported 9 of the ~22 real geometry kinds,
// so the AI structurally could not produce a chart, a slider or a grid table.
// SimScript is the app's own scene language, so there is nothing left to
// duplicate — and anything a user can create, the AI can now emit.

import { z } from 'zod'

/** One piece of a written answer, ready to become a notebook object.
 *  `text` carries Markdown, `formula` carries LaTeX. */
export const answerBlockSchema = z.object({
  kind: z.enum(['text', 'formula']),
  content: z.string(),
})

export const aiResponseSchema = z.object({
  /** Plain-language rationale shown next to the confirm button. */
  message: z.string(),
  /** Verified SimScript, ready to execute. Absent when generation failed. */
  script: z.string().optional(),
  /** A written answer — derivation, numerical or short note — as Markdown.
   *  Most coursework is not a simulation (of the course's own 100 questions,
   *  44 are derivations and 37 numericals), so this is the lane that carries
   *  the majority of real answers. */
  answer: z.string().optional(),
  /** The same answer pre-split into notebook objects, so the client can drop
   *  it onto a page without re-parsing the Markdown. */
  blocks: z.array(answerBlockSchema).optional(),
  /** A verified plan of edits to the page the user is on. Verified, NOT
   *  applied — the client previews it and the user confirms. Typed loosely
   *  here so lib/ai/edit-ops.ts stays the single source of truth for the op
   *  vocabulary; it is re-verified against the live page before applying. */
  editPlan: z
    .object({ ops: z.array(z.unknown()), summary: z.string() })
    .optional(),
})

export type AnswerBlock = z.infer<typeof answerBlockSchema>

export type AiResponse = z.infer<typeof aiResponseSchema>
