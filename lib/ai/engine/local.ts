'use client'

// The on-device engine: llama.cpp in WebAssembly (wllama v3), WebGPU when the
// browser has it, CPU otherwise. The model file is fetched once, kept in the
// browser's own storage, and loaded on demand; nothing a student types or
// draws leaves the device.
//
// This is the ONLY file that touches wllama. Everything above it sees
// ChatRequest/ChatReply and the SimScriptGenerator interface the existing
// pipeline already speaks — which is why generate → lint → repair needed no
// change to run here.

import type { SimScriptGenerator } from '@/lib/ai/generate'
import { GeneratorUnavailableError } from '@/lib/ai/generate'
import { MODELS, estimateRamMB, modelUrl, type Tier } from './catalog'
import { probeCapabilities } from './probe'
import { useEngine } from './store'

// ── Minimal shape of wllama we rely on (also what tests fake) ───────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ToolDef[]
  toolChoice?: 'auto' | 'required' | 'none'
  maxTokens?: number
  temperature?: number
  /** DISPLAY ONLY — fires as text arrives; never the authoritative output. */
  onToken?: (chunk: string) => void
  signal?: AbortSignal
}

export interface ChatReply {
  content: string
  toolCalls: { id: string; name: string; arguments: string }[]
  tokensPerSec: number | null
}

interface Chunk {
  choices: { delta: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason: string | null }[]
  timings?: { predicted_per_second?: number }
}

export interface WllamaLike {
  cacheManager: { list(): Promise<{ name: string; size: number; metadata: { originalURL: string } }[]>; deleteMany(p: (e: { metadata: { originalURL: string } }) => boolean): Promise<void> }
  loadModelFromUrl(url: string, params?: Record<string, unknown>): Promise<void>
  createChatCompletion(params: Record<string, unknown>): Promise<AsyncIterable<Chunk>>
  isMultithread?(): boolean
  getNumThreads?(): number
  isSupportWebGPU?(): boolean
  exit(): Promise<void>
}

const WASM_PATH = '/vendor/wllama/wllama.wasm'

async function realFactory(): Promise<WllamaLike> {
  // Dynamic: the 10 MB runtime must not be in the bundle of anyone who never
  // opens the assistant.
  const { Wllama } = await import('@wllama/wllama')
  return new Wllama({ default: WASM_PATH }, { allowOffline: true, suppressNativeLog: true }) as unknown as WllamaLike
}

/** Qwen3 may emit an empty think block; never show it. */
const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/^\s*<think>[\s\S]*$/, '')

/** Free memory after this long without a request. Weights stay on disk, so
 *  coming back costs seconds, not a download. */
const IDLE_MS = 10 * 60_000

export class LocalEngine {
  private w: WllamaLike | null = null
  private loaded: Tier | null = null
  private opening: Promise<void> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private idle: ReturnType<typeof setTimeout> | undefined

  constructor(private factory: () => Promise<WllamaLike> = realFactory, private idleMs = IDLE_MS) {}

  private async instance() {
    return (this.w ??= await this.factory())
  }

  /** Tiers whose file is completely in the browser cache. */
  async refreshCached(): Promise<Tier[]> {
    const w = await this.instance()
    const entries = await w.cacheManager.list().catch(() => [])
    const cached = (Object.keys(MODELS) as Tier[]).filter((t) => {
      const m = MODELS[t]
      const url = modelUrl(m)
      return entries.some((e) => e.metadata.originalURL === url && e.size >= m.sizeMB * 1e6 * 0.98)
    })
    useEngine.getState().patch({ cached })
    return cached
  }

  async probe() {
    const caps = await probeCapabilities()
    const st = useEngine.getState()
    st.patch({ caps, state: st.state === 'unknown' ? 'absent' : st.state })
    await this.refreshCached().catch(() => {})
    return caps
  }

  /**
   * Make `tier` ready: download if needed (progress is reported), then load
   * into memory. Safe to call repeatedly — concurrent callers share one open.
   */
  async ensure(tier: Tier, signal?: AbortSignal): Promise<void> {
    this.touch()
    if (this.loaded === tier && this.w) return
    if (this.opening) {
      await this.opening
      if (this.loaded === tier) return
    }
    this.opening = this.open(tier, signal).finally(() => {
      this.opening = null
    })
    return this.opening
  }

  private async open(tier: Tier, signal?: AbortSignal) {
    const store = useEngine.getState()
    const m = MODELS[tier]
    try {
      if (this.loaded && this.loaded !== tier) await this.release()
      const w = await this.instance()
      const wasCached = (await this.refreshCached()).includes(tier)
      store.patch({ state: wasCached ? 'loading' : 'downloading', tier, progress: 0, error: null })
      const caps = useEngine.getState().caps ?? (await this.probe())
      const base = {
        n_ctx: m.nCtx,
        useCache: true,
        signal,
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) =>
          useEngine.getState().patch({ progress: total ? loaded / total : 0 }),
        ...(caps.isolated ? { n_threads: Math.max(2, Math.min(4, Math.floor(caps.cores / 2))) } : {}),
      }
      try {
        // 8-bit KV cache halves the second-biggest memory cost.
        await w.loadModelFromUrl(modelUrl(m), { ...base, flash_attn: true, cache_type_k: 'q8_0', cache_type_v: 'q8_0' })
      } catch (e) {
        if (signal?.aborted) throw e
        // Some backends (older GPUs) lack quantised-KV kernels: retry plain.
        await w.loadModelFromUrl(modelUrl(m), base)
      }
      this.loaded = tier
      useEngine.getState().patch({
        state: 'ready',
        progress: 1,
        accel: w.isSupportWebGPU?.() ? 'webgpu' : 'cpu',
        threads: w.getNumThreads?.() ?? null,
        cached: Array.from(new Set([...useEngine.getState().cached, tier])),
      })
    } catch (e) {
      this.loaded = null
      const aborted = signal?.aborted
      useEngine.getState().patch({
        state: aborted ? 'absent' : 'error',
        error: aborted ? null : e instanceof Error ? e.message : String(e),
        progress: 0,
      })
      if (aborted) throw new GeneratorUnavailableError('Download cancelled.')
      throw new GeneratorUnavailableError(`Could not load the on-device model: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private touch() {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => void this.release(), this.idleMs)
  }

  /** Free the model's memory. The downloaded file stays. */
  async release() {
    clearTimeout(this.idle)
    const w = this.w
    this.loaded = null
    if (w) await w.exit().catch(() => {})
    this.w = null // wllama instances are single-use after exit()
    const st = useEngine.getState()
    if (st.state === 'ready' || st.state === 'generating') st.patch({ state: 'unloaded', progress: 0 })
  }

  /** Delete a tier's file from the browser cache. */
  async remove(tier: Tier) {
    if (this.loaded === tier) await this.release()
    const w = await this.instance()
    const url = modelUrl(MODELS[tier])
    await w.cacheManager.deleteMany((e) => e.metadata.originalURL === url)
    await this.refreshCached()
    const st = useEngine.getState()
    if (st.tier === tier) st.patch({ state: 'absent', tier: null })
  }

  isReady() {
    return this.loaded !== null
  }

  /** One chat completion. Requests are serialised: one model, one request. */
  chat(req: ChatRequest, tier?: Tier): Promise<ChatReply> {
    const run = async () => {
      const t = tier ?? this.loaded ?? useEngine.getState().tier
      if (!t) throw new GeneratorUnavailableError('The on-device model is not downloaded yet.')
      await this.ensure(t, req.signal)
      const w = await this.instance()
      useEngine.getState().patch({ state: 'generating' })
      try {
        const stream = await w.createChatCompletion({
          messages: req.messages,
          tools: req.tools,
          tool_choice: req.tools ? req.toolChoice ?? 'auto' : undefined,
          max_tokens: req.maxTokens ?? 700,
          temperature: req.temperature ?? 0.2,
          top_k: 40,
          top_p: 0.9,
          stream: true,
          cache_prompt: true,
          // Qwen3 reasons at length by default; a tutor that thinks for 800
          // tokens before every answer is a tutor on a 4-core laptop nobody
          // waits for.
          chat_template_kwargs: { enable_thinking: false },
          abortSignal: req.signal,
        })
        let content = ''
        let shown = ''
        let tps: number | null = null
        const calls = new Map<number, { id: string; name: string; arguments: string }>()
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          if (delta?.content) {
            content += delta.content
            // Hide think blocks from the live preview too.
            const clean = stripThink(content)
            if (clean.length > shown.length) {
              req.onToken?.(clean.slice(shown.length))
              shown = clean
            }
          }
          for (const tc of delta?.tool_calls ?? []) {
            const cur = calls.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, name: '', arguments: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name += tc.function.name
            if (tc.function?.arguments) cur.arguments += tc.function.arguments
            calls.set(tc.index, cur)
          }
          if (chunk.timings?.predicted_per_second) tps = chunk.timings.predicted_per_second
        }
        useEngine.getState().patch({ tps })
        return { content: stripThink(content).trim(), toolCalls: [...calls.values()].filter((c) => c.name), tokensPerSec: tps }
      } catch (e) {
        if (req.signal?.aborted) throw e
        throw new GeneratorUnavailableError(`On-device generation failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        this.touch()
        if (useEngine.getState().state === 'generating') useEngine.getState().patch({ state: 'ready' })
      }
    }
    // Serialise, and keep the chain alive after a failure.
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => {})
    return p
  }

  /** The existing pipeline's generator interface, backed by this engine. */
  generator(signal?: AbortSignal): SimScriptGenerator {
    return {
      name: 'on-device',
      generate: async (system, user, onToken, shots, maxTokens) => {
        const reply = await this.chat({
          messages: [{ role: 'system', content: system }, ...(shots ?? []), { role: 'user', content: user }],
          maxTokens,
          onToken,
          signal,
        })
        return reply.content
      },
    }
  }
}

export const localEngine = new LocalEngine()
export { estimateRamMB }
