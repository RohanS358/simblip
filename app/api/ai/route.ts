// AI gateway — one SimScript generation, statically verified before it can
// reach a canvas.
//
// This replaced a 103-tool function-calling agent whose tool schemas alone
// were ~17,981 prompt tokens, re-sent on every step of a loop that ran up to
// 24 times. The SimScript prompt is ~1,021 tokens and runs once: measured
// ~11.9s/round -> ~2.2s total on an RTX 4060. See
// docs/superpowers/specs/2026-08-18-simscript-ai-pipeline-design.md.
//
// The contract with the client is unchanged in spirit: NOTHING here touches
// the canvas. The route returns verified script text, and the user's "Add to
// canvas" button still executes it (now via executeSimScript rather than the
// old JSON importer), so the AI remains an assistant that produces the same
// thing a user could have typed by hand.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AiResponse } from '@/lib/ai/schema'
import {
  generateSimScript,
  GenerationFailedError,
  GeneratorUnavailableError,
  prewarm,
} from '@/lib/ai/generate'
import { SIMSCRIPT_SYSTEM_PROMPT } from '@/lib/ai/simscript-corpus'

export const maxDuration = 300

// Load the local model's weights once at module init rather than making the
// first user pay the 8.7s cold start. Fire-and-forget: a machine with no
// local Ollama is a supported configuration and this fails silently there.
void prewarm()

const requestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  pageContext: z
    .object({
      variables: z.array(z.object({ name: z.string(), expr: z.string() })),
      objectCount: z.number(),
    })
    .optional(),
})

/** The base language card plus whatever the page already contains, so the
 *  model reuses existing variables instead of redefining them and doesn't
 *  stack new objects on top of old ones. */
function systemPrompt(pageContext?: { variables: { name: string; expr: string }[]; objectCount: number }): string {
  const extra: string[] = []
  if (pageContext && pageContext.variables.length > 0) {
    extra.push(
      `The page already defines these variables — reuse them by name instead of redefining: ${pageContext.variables
        .map((v) => `${v.name}=${v.expr}`)
        .join(', ')}.`
    )
  }
  if (pageContext && pageContext.objectCount > 0) {
    extra.push(
      `The page already has ${pageContext.objectCount} object(s); give new components explicit x/y so they don't overlap.`
    )
  }
  return extra.length > 0 ? `${SIMSCRIPT_SYSTEM_PROMPT}\n\nPAGE CONTEXT\n${extra.join('\n')}` : SIMSCRIPT_SYSTEM_PROMPT
}

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

  try {
    const result = await generateSimScript(parsed.data.prompt, {
      systemPrompt: systemPrompt(parsed.data.pageContext),
    })
    return NextResponse.json({
      message:
        result.attempts > 1
          ? `Built it (took ${result.attempts} passes to get right).`
          : 'Built it — review the script, then add it to the canvas.',
      script: result.script,
    } satisfies AiResponse)
  } catch (e) {
    // A model that couldn't converge is reported honestly rather than
    // shipping a broken scene. The last attempt is returned so the user can
    // still read (and fix) what it tried.
    if (e instanceof GenerationFailedError) {
      return NextResponse.json({
        message: `${e.message}\n\nWhat went wrong: ${e.errors.slice(0, 3).join(' · ')}`,
        script: e.script || undefined,
      } satisfies AiResponse)
    }
    if (e instanceof GeneratorUnavailableError) {
      return NextResponse.json({ message: e.message } satisfies AiResponse)
    }
    return NextResponse.json({
      message: `AI pipeline error: ${e instanceof Error ? e.message : String(e)}`,
    } satisfies AiResponse)
  }
}
