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
import { classifyIntent, type Intent } from '@/lib/ai/route-intent'
import { explain, EXPLAIN_SYSTEM_PROMPT } from '@/lib/ai/explain'
import { pickGenerator } from '@/lib/ai/generate'

export const maxDuration = 300

// Load the local model's weights once at module init rather than making the
// first user pay the 8.7s cold start. Fire-and-forget: a machine with no
// local Ollama is a supported configuration and this fails silently there.
void prewarm()

/** Both response paths shape failures identically, so the client only ever
 *  has one thing to render. A model that couldn't converge is reported
 *  honestly rather than shipping a broken scene; its last attempt still comes
 *  back so the user can read (and fix) what it tried. */
function errorResponse(e: unknown): AiResponse {
  if (e instanceof GenerationFailedError) {
    return {
      message: `${e.message}\n\nWhat went wrong: ${e.errors.slice(0, 3).join(' · ')}`,
      script: e.script || undefined,
    }
  }
  if (e instanceof GeneratorUnavailableError) return { message: e.message }
  return { message: `AI pipeline error: ${e instanceof Error ? e.message : String(e)}` }
}

const requestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  /** Opt-in SSE. Off by default so the plain JSON contract still works. */
  stream: z.boolean().optional(),
  /** Override the router. The UI offers this as an explicit "explain" /
   *  "simulate" toggle for the cases where a question reads either way. */
  intent: z.enum(['simulate', 'explain', 'both', 'auto']).optional(),
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

  const intent: Intent =
    !parsed.data.intent || parsed.data.intent === 'auto'
      ? classifyIntent(parsed.data.prompt)
      : parsed.data.intent

  const system = systemPrompt(parsed.data.pageContext)
  const userPrompt = parsed.data.prompt

  // Run the explain lane. Shared by both transports so the two paths cannot
  // drift. No verify/repair loop here, unlike SimScript: nothing about a
  // derivation is statically checkable, so a second round would buy nothing.
  const runExplain = async (onToken?: (c: string) => void) => {
    const generator = await pickGenerator()
    const result = await explain(userPrompt, {
      generator,
      onToken,
      systemPrompt: EXPLAIN_SYSTEM_PROMPT,
    })
    return result
  }

  // Streaming path. ~2.1s of the ~2.2s SimScript generation is token
  // emission, and a derivation takes far longer still, so showing text as it
  // is written is the single biggest PERCEIVED speed win available — it makes
  // nothing faster, it removes the blank wait. Tokens are display only; the
  // terminating `done` event carries the authoritative payload (a script
  // cannot be checked until complete, and an unverified one must never reach
  // the canvas).
  if (parsed.data.stream) {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        try {
          // Tell the client which lane won, so it can render prose as prose
          // and script as script from the very first token.
          send('intent', intent)

          if (intent === 'explain') {
            const result = await runExplain((chunk) => send('token', chunk))
            send('done', {
              message: 'Answered — review it, then add it to your notebook.',
              answer: result.markdown,
              blocks: result.blocks,
            } satisfies AiResponse)
            return
          }

          if (intent === 'both') {
            // Explanation first: it is the answer, and it streams, so the user
            // reads while the scene is still being built.
            const answer = await runExplain((chunk) => send('token', chunk))
            let script: string | undefined
            try {
              script = (await generateSimScript(userPrompt, { systemPrompt: system })).script
            } catch {
              // A scene is the bonus here, not the deliverable. Losing it must
              // never cost the user a correct derivation.
            }
            send('done', {
              message: script
                ? 'Answered, and built a scene to go with it.'
                : 'Answered. (No simulation for this one — the working is above.)',
              answer: answer.markdown,
              blocks: answer.blocks,
              script,
            } satisfies AiResponse)
            return
          }

          const result = await generateSimScript(userPrompt, {
            systemPrompt: system,
            onToken: (chunk) => send('token', chunk),
          })
          send('done', {
            message:
              result.attempts > 1
                ? `Built it (took ${result.attempts} passes to get right).`
                : 'Built it — review the script, then add it to the canvas.',
            script: result.script,
          } satisfies AiResponse)
        } catch (e) {
          send('done', errorResponse(e))
        } finally {
          controller.close()
        }
      },
    })
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  try {
    if (intent === 'explain') {
      const result = await runExplain()
      return NextResponse.json({
        message: 'Answered — review it, then add it to your notebook.',
        answer: result.markdown,
        blocks: result.blocks,
      } satisfies AiResponse)
    }

    if (intent === 'both') {
      const answer = await runExplain()
      let script: string | undefined
      try {
        script = (await generateSimScript(userPrompt, { systemPrompt: system })).script
      } catch {
        // See the streaming path: the derivation is the deliverable.
      }
      return NextResponse.json({
        message: script
          ? 'Answered, and built a scene to go with it.'
          : 'Answered. (No simulation for this one — the working is above.)',
        answer: answer.markdown,
        blocks: answer.blocks,
        script,
      } satisfies AiResponse)
    }

    const result = await generateSimScript(userPrompt, { systemPrompt: system })
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
    return NextResponse.json(errorResponse(e))
  }
}
