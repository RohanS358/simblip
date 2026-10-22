'use client'

// The Director's model, over whichever backend the assistant is set to: the AI
// server (the big model plans, the fine-tuned one draws) or the on-device model.
// Both go through streamAi, so routing, auth and the lint/repair pipeline are the
// ones every other request already uses.

import { streamAi } from '@/lib/ai/transport'
import type { Llm } from './director'

async function ask(req: Parameters<typeof streamAi>[0], signal?: AbortSignal) {
  let done: { message: string; script?: string } | undefined
  await streamAi(req, signal ?? new AbortController().signal, (e) => {
    if (e.event === 'done') done = e.data
  })
  if (!done) throw new Error('The assistant did not answer.')
  return done
}

export const makeLlm = (): Llm => ({
  async complete(system, user, opts) {
    return (await ask({ prompt: user, rawSystem: system, ...(opts?.jsonSchema ? { rawFormat: opts.jsonSchema as Record<string, unknown> } : {}) }, opts?.signal)).message
  },
  async script(request, signal) {
    const r = await ask({ prompt: request, intent: 'simulate' }, signal)
    if (!r.script) throw new Error(r.message || 'no scene was produced')
    return r.script
  },
})
