// Thin client for a LOCAL Ollama server's native tool-calling (POST
// /api/chat with a `tools` array) — plain fetch, no SDK, the same "raw HTTP
// over a dependency" convention this project already uses for Supabase (see
// lib/sync/supabase.ts). Runs the standard agentic tool loop: call the
// model, execute any tool_calls it returns against the draft scene, feed
// the results back as `tool` messages, repeat until it stops calling tools,
// calls `finish`, or hits the step cap.
//
// Config: OLLAMA_HOST (default http://localhost:11434), OLLAMA_MODEL
// (default qwen2.5:7b — Alibaba's function-calling-tuned instruct model;
// noticeably better multi-step spatial/compositional reasoning across the
// ~85-tool catalog than the smaller qwen3.5:2b this defaulted to before,
// while still running on modest hardware at Q4. Any `ollama pull`ed
// tool-calling model works — override via env for something bigger/smaller).

import { ALL_TOOLS, createDraft, runTool, checkCircuitCompleteness, type DraftState } from './tools'

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b'
const MAX_STEPS = 24
const REQUEST_TIMEOUT_MS = 180_000

export class OllamaUnreachableError extends Error {}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string }
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: OllamaToolCall[]
}

interface ChatResponse {
  message: OllamaMessage
  done?: boolean
}

async function chat(messages: OllamaMessage[]): Promise<ChatResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        tools: ALL_TOOLS,
        stream: false,
        // The ~95-tool catalog alone runs several thousand tokens; Ollama's
        // default num_ctx (≈4096) leaves no room left to actually generate,
        // silently truncating (done_reason "length", eval_count 1). Request
        // a much larger window explicitly — still far under what a modern
        // local model supports.
        // Keep the model resident between requests — Ollama's default
        // keep_alive (5m) unloads it between separate test prompts, paying
        // the full multi-second weight-load cost again each time.
        keep_alive: '30m',
        // Tool-calling turns should be a handful of function calls, not an
        // essay; capping generation bounds worst-case latency per round.
        options: { temperature: 0.2, num_ctx: 32768, num_predict: 768 },
      }),
      signal: controller.signal,
    })
    if (process.env.AI_DEBUG) {
      console.log(`[ai-debug] request: tools=${ALL_TOOLS.length} bodyBytes=${JSON.stringify({ model: OLLAMA_MODEL, messages, tools: ALL_TOOLS }).length}`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Ollama responded ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`)
    }
    const json = (await res.json()) as ChatResponse
    if (process.env.AI_DEBUG) {
      console.log(`[ai-debug] raw response:`, JSON.stringify(json).slice(0, 2000))
    }
    return json
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new OllamaUnreachableError(`Ollama request to ${OLLAMA_HOST} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
    }
    throw new OllamaUnreachableError(
      `Couldn't reach Ollama at ${OLLAMA_HOST} (model "${OLLAMA_MODEL}"). Run \`ollama serve\` and \`ollama pull ${OLLAMA_MODEL}\`, then try again. (${e instanceof Error ? e.message : String(e)})`
    )
  } finally {
    clearTimeout(timeout)
  }
}

export interface AgentResult {
  message: string
  draft: DraftState
  steps: number
}

export async function runAgent(systemPrompt: string, userPrompt: string): Promise<AgentResult> {
  const draft = createDraft()
  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  let steps = 0
  let finalMessage = ''
  // Blocking `finish` until a batch's errors clear (below) is only useful
  // while the model is actually converging — if it keeps making the SAME
  // kind of invalid call round after round (e.g. trying to `attach` two
  // solid bodies, which will never succeed no matter how many times it's
  // retried), blocking forever just burns the whole step budget re-placing
  // duplicate objects. Give it a few chances, then stop insisting.
  const MAX_CONSECUTIVE_ERROR_ROUNDS = 3
  let consecutiveErrorRounds = 0
  // A second, independent backstop: regardless of why, a stuck model
  // shouldn't be able to flood the page with dozens of duplicate objects.
  const MAX_DRAFT_OBJECTS = 40

  while (steps < MAX_STEPS) {
    steps++
    const response = await chat(messages)
    const msg = response.message
    if (process.env.AI_DEBUG) {
      console.log(`[ai-debug] step ${steps} content="${msg.content}" tool_calls=`, JSON.stringify(msg.tool_calls))
    }
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalMessage = msg.content?.trim() ?? ''
      break
    }

    // A single turn can bundle many tool_calls (e.g. place spring, place
    // mass, attach, attach, finish) — but the model picked every index
    // before seeing any of THIS batch's results, so an attach/connect call
    // referencing an object placed earlier in the same batch is a guess.
    // If anything in the batch actually failed, don't honor `finish` yet:
    // let the model see the error and retry next round instead of shipping
    // a simulation it silently got wrong (unless it's stuck — see above).
    let calledFinish = false
    let finishMessage = ''
    let anyError = false
    for (const call of msg.tool_calls) {
      const name = call.function.name
      let args: Record<string, unknown> = {}
      try {
        args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments
      } catch {
        args = {}
      }
      if (name === 'finish') {
        finishMessage = String(args.message ?? 'Done.')
        calledFinish = true
        continue
      }
      const result = runTool(draft, name, args)
      if (!result.ok) anyError = true
      messages.push({ role: 'tool', content: JSON.stringify(result) })
    }

    // Tool-call bookkeeping saying every call "succeeded" doesn't mean the
    // result is actually a working circuit — verify against the real netlist
    // builder before letting finish stick (see checkCircuitCompleteness).
    const completenessError = calledFinish && !anyError ? checkCircuitCompleteness(draft.objects) : null
    if (completenessError) anyError = true
    consecutiveErrorRounds = anyError ? consecutiveErrorRounds + 1 : 0

    if (draft.objects.length >= MAX_DRAFT_OBJECTS) {
      finalMessage = finishMessage || 'Built the simulation below — press Play to run it.'
      break
    }
    if (anyError) {
      // The failure mode actually observed here isn't the model refusing to
      // retry — it's re-placing everything from scratch instead of fixing
      // just the one bad call (e.g. a wrong pin on `connect`), producing 2-4x
      // duplicate objects per retry. Ground it in what already exists so the
      // cheap fix (reuse the index) is more obvious than the expensive one
      // (start over).
      messages.push({
        role: 'tool',
        content: JSON.stringify({
          note: 'Do NOT call place_* again for anything below — it already exists. Fix only the failed call(s) above, reusing these placed_index values.',
          objects: draft.objects.map((o, i) => ({ placed_index: i, name: o.name })),
        }),
      })
    }
    if (calledFinish) {
      if (!anyError || consecutiveErrorRounds > MAX_CONSECUTIVE_ERROR_ROUNDS) {
        finalMessage = finishMessage
        break
      }
      messages.push({
        role: 'tool',
        content: JSON.stringify({ ok: false, error: completenessError ?? 'finish ignored — fix the failed call(s) above first, then call finish again.' }),
      })
    }
  }

  if (!finalMessage) {
    finalMessage =
      draft.objects.length > 0
        ? 'Built the simulation below — press Play to run it.'
        : "I couldn't finish building a simulation for that prompt (ran out of steps or the model stalled). Try a more specific or smaller request, or a bigger tool-calling model via OLLAMA_MODEL."
  }

  return { message: finalMessage, draft, steps }
}
