'use client'

// How a request reaches a model: on THIS device, or on the server.
//
// The panel asks for events; it does not know which. Both paths speak the same
// AiEvent stream, because both run lib/ai/run.ts — the server inside
// /api/ai, the device right here against the on-device model.
//
//   auto   = on the device once a model is downloaded, else the server
//   device = only the device (never sends anything out)
//   server = only the server (Ollama or hosted)

import { aiAuthHeaders, describeAiRefusal } from './auth-header'
import { runAi, type AiEvent, type AiRequest } from '@/lib/ai/run'
import { localEngine } from '@/lib/ai/engine/local'
import { MODELS, type Tier } from '@/lib/ai/engine/catalog'
import { useEngine, useEnginePrefs } from '@/lib/ai/engine/store'
import { makeAct } from '@/lib/ai/tutor/act'
import { activeContext } from '@/lib/tools/context'
import { setToolGenerator } from '@/lib/tools/registry'
import '@/lib/tools'

export type Route = { where: 'device'; tier: Tier } | { where: 'server' } | { where: 'blocked'; why: string }

let serverOnce = false
/** Send the NEXT request to the server, once. For the case where the device is
 *  too slow for what was asked (a scene on a CPU-only laptop) and the user
 *  chooses to trade privacy for speed — per request, never silently. */
export const useServerOnce = () => {
  serverOnce = true
}

/** Where the next request goes, and why not if it can't. */
export function resolveRoute(): Route {
  if (serverOnce) return { where: 'server' }
  const { backend, tier: pref } = useEnginePrefs.getState()
  const { cached, caps, tier: loaded } = useEngine.getState()
  const tier = pref && cached.includes(pref) ? pref : loaded && cached.includes(loaded) ? loaded : cached[0]
  if (backend === 'server') return { where: 'server' }
  if (tier) return { where: 'device', tier }
  if (backend === 'device') {
    return {
      where: 'blocked',
      why: caps?.recommended
        ? `Download the ${MODELS[caps.recommended].label} model first (${MODELS[caps.recommended].sizeMB >= 1000 ? (MODELS[caps.recommended].sizeMB / 1000).toFixed(1) + ' GB' : MODELS[caps.recommended].sizeMB + ' MB'}) — it runs entirely on this device.`
        : 'This device cannot run the on-device model. Switch to Server in the assistant settings.',
    }
  }
  return { where: 'server' }
}

// Tools that need a model (scene.build) use whatever is live right now.
setToolGenerator(async () => {
  const r = resolveRoute()
  if (r.where !== 'device') return null
  await localEngine.ensure(r.tier)
  return localEngine.generator()
})

/** Read a Server-Sent Events body, handing each event to `onEvent`. A frame
 *  may be split across chunks, so the trailing partial frame is carried over.
 *
 *  Callbacks, not an async generator: the bundler's async-generator helper
 *  (`awaitWrap`) was missing at runtime in the browser build, and a plain
 *  loop is simpler anyway. */
async function readSse(res: Response, onEvent: (e: AiEvent) => void): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = /^event:\s*(.+)$/m.exec(frame)?.[1]
      const raw = /^data:\s*([\s\S]*)$/m.exec(frame)?.[1]
      if (!event || raw === undefined) continue
      onEvent({ event, data: JSON.parse(raw) } as AiEvent)
    }
  }
}

/** Run one request wherever it belongs, reporting events as they happen. Always
 *  ends with exactly one `done` unless the request is aborted (which throws). */
export async function streamAi(req: AiRequest, signal: AbortSignal, onEvent: (e: AiEvent) => void): Promise<void> {
  const route = resolveRoute()
  serverOnce = false

  if (route.where === 'blocked') {
    onEvent({ event: 'done', data: { message: route.why } })
    return
  }

  if (route.where === 'server') {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aiAuthHeaders() },
      signal,
      body: JSON.stringify({ ...req, stream: true }),
    })
    if (!res.ok) {
      // sign-in needed, rate limit, too large: say so instead of failing to parse an event stream
      onEvent({ event: 'done', data: { message: await describeAiRefusal(res) } })
      return
    }
    return readSse(res, onEvent)
  }

  // On this device. Worked examples are what make a small model write valid
  // SimScript (zero-shot, Qwen3-0.6B copied the page's spring-mass into a
  // "voltage divider"; with 3 examples it wrote R1/R2 correctly) — but each is
  // ~400 prompt tokens, and reading the prompt IS the wait on a laptop CPU
  // (~40 tok/s measured). 2 is the compromise; fine-tuning removes the need for
  // them entirely (docs/ai-plans), and the panel offers "use the server" for a
  // single slow request.
  const devShots = (globalThis as { __aiOpts?: { shots?: number } }).__aiOpts?.shots
  req = { ...req, shots: req.shots ?? devShots ?? 2 }
  const generator = () => Promise.resolve(localEngine.generator(signal))
  try {
    await localEngine.ensure(route.tier, signal)
    await runAi(req, {
      script: generator,
      explain: generator,
      emit: onEvent,
      streaming: true,
      act: makeAct({ engine: { chat: (r) => localEngine.chat({ ...r, signal }, route.tier) }, ctx: () => activeContext(signal), emit: onEvent, signal }),
    })
  } catch (e) {
    if (signal.aborted) throw e
    onEvent({ event: 'done', data: { message: e instanceof Error ? e.message : 'On-device generation failed.' } })
  }
}
