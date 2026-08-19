// SimScript generation: one model call, verified before it reaches the canvas.
//
// This replaces the 103-tool function-calling agent that used to live in
// ollama.ts + tools.ts. Measured on an RTX 4060, same prompt for both:
//
//                    SimScript      tool-calling
//   system prompt     1,021 tok      17,981 tok
//   warm round          ~2.2 s          ~11.9 s
//   rounds                   1        up to 24
//
// The tool catalog was re-sent on every step of the loop, and tool-call JSON
// is ~5x more verbose per object than `create("bulb", {R:20});`. SimScript is
// simply a denser encoding of the same scene.
//
// The pipeline is:
//
//   generate ──▶ verify ──▶ ok? ──▶ script
//    (~2.2s)     (<1ms)      │
//                   ▲        └─no─▶ repair (max 2, ~2.2s each)
//                   └─────────────────┘
//
// The economics that make this work: VERIFICATION IS FREE, GENERATION IS NOT.
// The common case pays nothing for safety, and only a genuine failure costs a
// round. See lib/ai/simscript-lint.ts for what "verify" covers.

import { lintSimScript } from './simscript-lint'
import { fewShotMessages } from './few-shot'
import { SIMSCRIPT_SYSTEM_PROMPT } from './simscript-corpus'

/** How many repair attempts before giving up and reporting honestly. A model
 *  that has not converged in two tries is not going to on the third — it just
 *  burns latency. Measured: the worst real failure converged in two. */
const MAX_REPAIRS = 2

export class GeneratorUnavailableError extends Error {}

/**
 * A backend that turns a prompt into SimScript text.
 *
 * Both implementations share the same system prompt and the same output
 * format, which is exactly what makes them interchangeable — the
 * representation choice, not an abstraction layer, is what buys the
 * portability.
 */
export interface SimScriptGenerator {
  readonly name: string
  /** `onToken` is DISPLAY ONLY. It fires as text arrives so the UI can show
   *  the script being written (~2.1s of the ~2.2s is generation, so this is
   *  the whole perceived-speed win). It is never the authoritative output —
   *  only the verified return value is, because a script can only be checked
   *  once it is complete. */
  generate(
    system: string,
    user: string,
    onToken?: (chunk: string) => void,
    /** Worked examples inserted as prior turns, before the real question.
     *  See lib/ai/few-shot.ts for why this is the highest-value lever here. */
    shots?: { role: 'user' | 'assistant'; content: string }[],
    /** Output budget in tokens. Defaults to the SimScript figure — a scene is
     *  short. A prose answer is not: measured, a filters short-note ran 2445
     *  characters and was cut mid-word at the 700-token default, which then
     *  surfaced downstream as an orphaned `**` on a slide. See EXPLAIN_TOKENS. */
    maxTokens?: number
  ): Promise<string>
}
// ── Stream readers ──────────────────────────────────────────────────────────
// Two wire formats, one job: hand each text chunk to `onToken` and return the
// full text at the end. Both must tolerate a chunk boundary landing mid-line,
// which is why the trailing partial line is carried over rather than parsed.

/** Ollama: newline-delimited JSON, one object per token. */
async function readNdjson(
  res: Response,
  pick: (o: unknown) => string | undefined,
  onToken: (chunk: string) => void
): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // last element may be a partial line
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const piece = pick(JSON.parse(line))
        if (piece) { full += piece; onToken(piece) }
      } catch {
        // A malformed line is not worth failing the whole generation over.
      }
    }
  }
  return full
}

/** OpenAI-compatible SSE: `data: {...}` lines, ending with `data: [DONE]`. */
async function readSse(res: Response, onToken: (chunk: string) => void): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const o = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
        const piece = o.choices?.[0]?.delta?.content
        if (piece) { full += piece; onToken(piece) }
      } catch {
        // ditto
      }
    }
  }
  return full
}

// ── Local: Ollama ───────────────────────────────────────────────────────────

/** ~4 chars/token is the standard rough figure and is plenty here — this only
 *  ever sizes a context window upward, so erring high is free and erring low
 *  is a truncated generation. */
const estimateTokens = (s: string) => Math.ceil(s.length / 4)
/** Ollama is happiest with power-of-two context windows. */
const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)))

/** Output budget for a SimScript scene. A scene is a handful of create()
 *  calls; 700 tokens has always been ample. */
export const SCRIPT_TOKENS = 700

/** Output budget for a prose answer. A derivation or a multi-part short note
 *  is far longer than a scene: measured, "explain high-pass, low-pass,
 *  band-pass and band-stop filters" ran 2445 characters and was still cut
 *  mid-word at 700 tokens, losing the last section outright. Truncation is
 *  silent — the answer simply stops — so this is sized to clear the longest
 *  answers in the course's own question set with headroom. */
export const EXPLAIN_TOKENS = 2000

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
/** The default for both lanes. `simblip-simscript` is not a stock model: it
 *  is built by buildModelfile() (lib/ai/simscript-corpus.ts) with the
 *  SimScript prompt and twelve few-shots baked into its template. */
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'simblip-simscript'

/** Per-lane model overrides.
 *
 *  The two lanes want different things from a model and are separate calls,
 *  so there is no reason they must share one. Writing SimScript is a coding
 *  task — the default is a code-specialised base (qwen2.5-coder) fine-tuned
 *  on the corpus. Writing a derivation is prose and mathematics, where a
 *  larger general model is often better and none of the SimScript tuning
 *  applies.
 *
 *  Falls back to OLLAMA_MODEL, so setting nothing keeps today's behaviour
 *  exactly and setting only OLLAMA_MODEL still moves both lanes together. */
const OLLAMA_SCRIPT_MODEL = process.env.OLLAMA_SCRIPT_MODEL ?? OLLAMA_MODEL
const OLLAMA_EXPLAIN_MODEL = process.env.OLLAMA_EXPLAIN_MODEL ?? OLLAMA_MODEL
/** Per-call ceiling. 60s was sized for a lone SimScript scene (~2.2s warm),
 *  but a "both" request runs the explain lane AND the script lane back to
 *  back on one GPU, and a prose answer now has a 2000-token budget. Measured:
 *  a pendulum "slides + simulation" turn spent long enough on the answer that
 *  the scene call hit 60s and was dropped, surfacing as a deck with no
 *  simulation. The route itself allows 300s (maxDuration), so this was the
 *  binding limit, not a safety one. */
const OLLAMA_TIMEOUT_MS = 120_000

/** Build a generator bound to one Ollama model. Everything below is
 *  model-agnostic — a plain /api/chat call with a system role — so the model
 *  name is the only thing that varies between lanes. */
export function makeOllamaGenerator(model: string): SimScriptGenerator {
  return {
  name: `ollama:${model}`,
  async generate(system, user, onToken, shots, maxTokens) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS)
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            ...(shots ?? []),
            { role: 'user', content: user },
          ],
          stream: !!onToken,
          // Cold start measured at 8.7s — nearly 4x the warm generation
          // itself, and the single largest component of perceived latency.
          // Keeping the weights resident removes it entirely.
          keep_alive: '30m',
          // The prompt is ~1k tokens, so a large context window buys nothing
          // and costs KV cache on an 8GB card. (The old tool path needed
          // 32768 purely to fit its own tool schemas.) num_ctx must still
          // cover prompt + output, so it grows with an enlarged budget —
          // otherwise a longer answer silently pushes the prompt out.
          options: {
            temperature: 0.2,
            num_ctx: nextPow2(estimateTokens(system + user) + (maxTokens ?? SCRIPT_TOKENS) + 512),
            num_predict: maxTokens ?? SCRIPT_TOKENS,
          },
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Ollama responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
      }
      if (!onToken) {
        const json = (await res.json()) as { message?: { content?: string } }
        return json.message?.content ?? ''
      }
      // Ollama streams newline-delimited JSON, one object per token.
      return await readNdjson(res, (o) => (o as { message?: { content?: string } }).message?.content, onToken)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new GeneratorUnavailableError(`Ollama timed out after ${OLLAMA_TIMEOUT_MS / 1000}s`)
      }
      throw new GeneratorUnavailableError(
        `Couldn't reach Ollama at ${OLLAMA_HOST} (model "${model}"). Run \`ollama serve\`, then try again.`
      )
    } finally {
      clearTimeout(timer)
    }
  },
  }
}

/** The script lane's generator, and the default everything else picks up. */
export const ollamaGenerator: SimScriptGenerator = makeOllamaGenerator(OLLAMA_SCRIPT_MODEL)

/** The explain lane's generator. Identical unless OLLAMA_EXPLAIN_MODEL is set. */
export const ollamaExplainGenerator: SimScriptGenerator =
  OLLAMA_EXPLAIN_MODEL === OLLAMA_SCRIPT_MODEL ? ollamaGenerator : makeOllamaGenerator(OLLAMA_EXPLAIN_MODEL)

// ── Hosted: OpenRouter ──────────────────────────────────────────────────────
// OpenAI-compatible, so this is a plain fetch rather than another SDK — the
// same "raw HTTP over a dependency" convention the rest of this project uses.
// This is the only path that works for deployed users, who cannot run Ollama
// at all. The ~1k-token prompt is what keeps the per-request cost negligible.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'openrouter/free'
const OPENROUTER_TIMEOUT_MS = 60_000

export const openRouterGenerator: SimScriptGenerator = {
  name: `openrouter:${OPENROUTER_MODEL}`,
  async generate(system, user, onToken, shots, maxTokens) {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) throw new GeneratorUnavailableError('OPENROUTER_API_KEY is not set')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS)
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          // Optional attribution headers — they only affect OpenRouter's
          // leaderboards, never routing or cost.
          'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL ?? 'https://simblip.rohan-singh.com.np',
          'X-Title': 'SIMBLIP',
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: system },
            ...(shots ?? []),
            { role: 'user', content: user },
          ],
          temperature: 0.2,
          max_tokens: maxTokens ?? EXPLAIN_TOKENS,
          stream: !!onToken,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`OpenRouter responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
      }
      if (!onToken) {
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        return json.choices?.[0]?.message?.content ?? ''
      }
      // OpenAI-compatible SSE: `data: {...}` lines, terminated by `data: [DONE]`.
      return await readSse(res, onToken)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new GeneratorUnavailableError(`OpenRouter timed out after ${OPENROUTER_TIMEOUT_MS / 1000}s`)
      }
      if (e instanceof GeneratorUnavailableError) throw e
      throw new GeneratorUnavailableError(
        `OpenRouter request failed: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  },
}

/**
 * Which backend to use.
 *
 * Local when it is actually reachable (free, private, works offline), hosted
 * otherwise — which is the deployed case, where Ollama does not exist. The
 * probe is a cheap GET with a short timeout so a missing local server costs
 * ~200ms, not a full request timeout.
 */
/** Which lane is asking. Only affects WHICH local model is chosen; the
 *  hosted fallback is one model either way (OpenRouter bills per token, and
 *  splitting that has no upside). Defaults to 'script' so existing callers
 *  keep the behaviour they had. */
export type Lane = 'script' | 'explain'

export async function pickGenerator(lane: Lane = 'script'): Promise<SimScriptGenerator> {
  const local = lane === 'explain' ? ollamaExplainGenerator : ollamaGenerator
  if (process.env.AI_BACKEND === 'openrouter') return openRouterGenerator
  if (process.env.AI_BACKEND === 'ollama') return local
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 400)
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal })
    clearTimeout(timer)
    if (res.ok) return local
  } catch {
    // not running locally — fall through
  }
  return openRouterGenerator
}

// ── The pipeline ────────────────────────────────────────────────────────────

export interface GenerateResult {
  /** Verified SimScript, ready to execute. */
  script: string
  /** How many model calls it took (1 = clean first pass). */
  attempts: number
  /** Which backend produced it — surfaced for debugging, not to the user. */
  backend: string
  /** Non-fatal notes from the verifier (stripped fences, etc.). */
  warnings: string[]
}

export class GenerationFailedError extends Error {
  constructor(message: string, readonly script: string, readonly errors: string[]) {
    super(message)
  }
}

/**
 * Build the repair prompt.
 *
 * Deliberately narrow: the model is shown its own script and the exact
 * problems, and told to change nothing else. Open-ended "try again" makes a
 * small model rewrite the whole scene and lose the parts that were correct.
 */
function repairPrompt(script: string, errors: string[]): string {
  return [
    'Your previous SimScript had errors. Fix ONLY these problems and return the corrected script.',
    'Keep everything that was already correct — do not redesign the scene, do not add components.',
    '',
    'Errors:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Your previous script:',
    script,
  ].join('\n')
}

/**
 * Generate verified SimScript for a prompt.
 *
 * Throws GenerationFailedError when the model cannot produce a valid script
 * within the repair budget — the caller should surface that honestly rather
 * than pushing a broken scene onto the user's canvas.
 */
export async function generateSimScript(
  userPrompt: string,
  opts: {
    generator?: SimScriptGenerator
    systemPrompt?: string
    /** Display-only token callback; see SimScriptGenerator.generate. Fires on
     *  the FIRST attempt only — streaming a repair would show the user the
     *  script being rewritten, which reads as a glitch rather than progress. */
    onToken?: (chunk: string) => void
  } = {}
): Promise<GenerateResult> {
  const generator = opts.generator ?? (await pickGenerator())
  const system = opts.systemPrompt ?? SIMSCRIPT_SYSTEM_PROMPT

  // Worked examples closest to this request. The corpus built these all
  // along and nothing ever sent them to the model; retrieving four lifted
  // lint-clean output from 7/15 to 12/15 on held-out course prompts.
  const shots = fewShotMessages(userPrompt)

  let prompt = userPrompt
  let lastScript = ''
  let lastErrors: string[] = []

  for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt++) {
    // Examples go only to the first attempt. A repair turn already carries
    // the script being fixed, and re-showing four unrelated scenes invites
    // the model to redesign rather than repair.
    const raw = await generator.generate(
      system,
      prompt,
      attempt === 1 ? opts.onToken : undefined,
      attempt === 1 ? shots : undefined
    )
    const result = lintSimScript(raw)
    lastScript = result.cleaned
    lastErrors = result.errors

    if (result.ok) {
      return {
        script: result.cleaned,
        attempts: attempt,
        backend: generator.name,
        warnings: result.warnings,
      }
    }
    prompt = repairPrompt(result.cleaned, result.errors)
  }

  throw new GenerationFailedError(
    "The model couldn't produce a valid simulation for that request. Try rephrasing it.",
    lastScript,
    lastErrors
  )
}

/**
 * Load the local model's weights without doing any real work.
 *
 * Cold start is 8.7s on an RTX 4060 — nearly 4x the warm generation. Calling
 * this once at server start means the first real user request pays only the
 * ~2.2s generation, not 11s. Failure is deliberately silent: this is an
 * optimisation, and a machine with no Ollama is a supported configuration.
 */
export async function prewarm(): Promise<void> {
  // Both lanes, when they differ: a "both" request runs them back to back, so
  // leaving the second model cold just moves the 8.7s cold start onto the
  // first user who asks a question that needs it. Deduped, so the common
  // single-model setup still fires exactly one warmup.
  const models = [...new Set([OLLAMA_SCRIPT_MODEL, OLLAMA_EXPLAIN_MODEL])]
  await Promise.all(models.map((m) => warmOne(m)))
}

async function warmOne(model: string): Promise<void> {
  try {
    await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        keep_alive: '30m',
        options: { num_predict: 1, num_ctx: 4096 },
      }),
    })
  } catch {
    // No local model here — the hosted backend needs no warming.
  }
}
