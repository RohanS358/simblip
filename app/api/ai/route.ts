// AI gateway — the SERVER backend. The lane logic lives in lib/ai/run.ts and
// is shared with the browser, where the on-device model runs the same code.
// What stays here is what only a server can do: reach Ollama or OpenRouter,
// and memoize generations in Redis.
//
// NOTHING here touches the canvas. The route returns verified script text, and
// the user's "Add to canvas" button still executes it, so the AI remains an
// assistant that produces the same thing a user could have typed by hand.
// See docs/superpowers/specs/2026-08-18-simscript-ai-pipeline-design.md.

import { NextResponse } from 'next/server'
import type { AiResponse } from '@/lib/ai/schema'
import { prewarm, pickGenerator } from '@/lib/ai/generate'
import { withCache } from '@/lib/ai/cache'
import { aiRequestSchema, runAi, type AiEvent } from '@/lib/ai/run'

/**
 * The generator every lane runs through, memoized in Redis.
 *
 * Wrapping HERE rather than inside lib/ai/generate.ts keeps ioredis out of
 * the pure lib chain — simscript-lint and explain are bundled for the browser
 * and for the sweep scripts, and a server-only import in that graph breaks
 * both.
 */
const cachedGenerator = async (lane: 'script' | 'explain', model?: string, bypass?: boolean) => {
  const generator = await pickGenerator(lane, model)
  return bypass && process.env.NODE_ENV !== 'production' ? generator : withCache(generator)
}

export const maxDuration = 300

// Load the local model's weights once at module init rather than making the
// first user pay the 8.7s cold start. Fire-and-forget: a machine with no
// local Ollama is a supported configuration and this fails silently there.
void prewarm()

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = aiRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const r = parsed.data

  const deps = (emit: (e: AiEvent) => void, streaming: boolean) => ({
    script: () => cachedGenerator('script', r.model, r.nocache),
    explain: () => cachedGenerator('explain', r.model, r.nocache),
    emit,
    streaming,
  })

  // Streaming path. Showing text as it is written is the biggest PERCEIVED
  // speed win available — it removes the blank wait. Tokens are display only;
  // the terminating `done` event carries the authoritative payload (a script
  // cannot be checked until complete, and an unverified one must never reach
  // the canvas).
  if (r.stream) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        await runAi(r, deps((e) => controller.enqueue(encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)), true))
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
    })
  }

  let result: AiResponse = { message: 'No response.' }
  await runAi(r, deps((e) => { if (e.event === 'done') result = e.data }, false))
  return NextResponse.json(result)
}
