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

export const aiResponseSchema = z.object({
  /** Plain-language rationale shown next to the confirm button. */
  message: z.string(),
  /** Verified SimScript, ready to execute. Absent when generation failed. */
  script: z.string().optional(),
})

export type AiResponse = z.infer<typeof aiResponseSchema>
