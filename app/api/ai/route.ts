// AI gateway — backed by a LOCAL Ollama model with native tool-calling.
// Every palette component is a generated tool (lib/ai/tools.ts, derived from
// the same COMPONENTS/BEHAVIOR_SPECS registries the palette and Inspector
// read); the model calls them to build a real draft scene, which is
// validated against the Simulation JSON schema and returned. Nothing here
// ever touches the canvas directly — the client's "Add to canvas" button is
// still the only path in (lib/ai/import.ts), same contract as before.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { aiResponseSchema, type AiResponse } from '@/lib/ai/schema'
import { runAgent, OllamaUnreachableError } from '@/lib/ai/ollama'
import { draftToPayload } from '@/lib/ai/tools'

export const maxDuration = 300

const requestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  pageContext: z
    .object({
      variables: z.array(z.object({ name: z.string(), expr: z.string() })),
      objectCount: z.number(),
    })
    .optional(),
})

function systemPrompt(pageContext?: { variables: { name: string; expr: string }[]; objectCount: number }): string {
  const existingVars =
    pageContext && pageContext.variables.length > 0
      ? `The page already has these variables — reuse them by name instead of redefining: ${pageContext.variables.map((v) => `${v.name}=${v.expr}`).join(', ')}.`
      : ''
  return "only provide script"}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  let response: AiResponse
  try {
    const agent = await runAgent(systemPrompt(parsed.data.pageContext), parsed.data.prompt)
    response = {
      message: agent.message,
      simulation:
        agent.draft.objects.length > 0
          ? draftToPayload(agent.draft, parsed.data.prompt.slice(0, 60), agent.message)
          : undefined,
    }
  } catch (e) {
    if (e instanceof OllamaUnreachableError) {
      return NextResponse.json({ message: e.message } satisfies AiResponse)
    }
    return NextResponse.json({ message: `AI pipeline error: ${e instanceof Error ? e.message : String(e)}` } satisfies AiResponse)
  }

  // Validate our own output — the model's tool arguments can still be
  // malformed (e.g. a non-existent behavior param), so this is the same
  // gate any future non-Ollama backend would have to pass too.
  const validated = aiResponseSchema.safeParse(response)
  if (!validated.success) {
    return NextResponse.json({
      message: `${response.message}\n\n(Note: the built simulation failed validation and was dropped: ${validated.error.issues[0]?.message ?? 'unknown error'})`,
    } satisfies AiResponse)
  }
  return NextResponse.json(validated.data)
}
