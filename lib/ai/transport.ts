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

import { runAi, type AiEvent, type AiRequest } from '@/lib/ai/run'
import { localEngine } from '@/lib/ai/engine/local'
import { MODELS, type Tier } from '@/lib/ai/engine/catalog'
import { useEngine, useEnginePrefs } from '@/lib/ai/engine/store'
import { makeAct } from '@/lib/ai/tutor/act'
import { activeContext } from '@/lib/tools/context'
import { setToolGenerator } from '@/lib/tools/registry'
import '@/lib/tools'

export type Route = { where: 'device'; tier: Tier } | { where: 'server' } | { where: 'blocked'; why: string }

/** Where the next request goes, and why not if it can't. */
export function resolveRoute(): Route {
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

/** Parse a Server-Sent Events body into AiEvents. A frame may be split across
 *  chunks, so the trailing partial frame is carried over. */
async function* readSse(res: Response): AsyncGenerator<AiEvent> {
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
      yield { event, data: JSON.parse(raw) } as AiEvent
    }
  }
}

/** A queue that turns runAi's callback into something `for await` can read. */
function channel<T>() {
  const items: T[] = []
  let wake: (() => void) | null = null
  let closed = false
  return {
    push(v: T) {
      items.push(v)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length) yield items.shift() as T
        if (closed) return
        await new Promise<void>((r) => (wake = r))
        wake = null
      }
    },
  }
}

export async function* streamAi(req: AiRequest, signal: AbortSignal): AsyncGenerator<AiEvent> {
  const route = resolveRoute()

  if (route.where === 'blocked') {
    yield { event: 'done', data: { message: route.why } }
    return
  }

  if (route.where === 'server') {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ ...req, stream: true }),
    })
    yield* readSse(res)
    return
  }

  // On this device.
  const ch = channel<AiEvent>()
  const generator = () => Promise.resolve(localEngine.generator(signal))
  const run = (async () => {
    try {
      await localEngine.ensure(route.tier, signal)
      await runAi(req, {
        script: generator,
        explain: generator,
        emit: (e) => ch.push(e),
        streaming: true,
        act: makeAct({ engine: { chat: (r) => localEngine.chat({ ...r, signal }, route.tier) }, ctx: () => activeContext(signal), emit: (e) => ch.push(e), signal }),
      })
    } catch (e) {
      ch.push({ event: 'done', data: { message: e instanceof Error ? e.message : 'On-device generation failed.' } })
    } finally {
      ch.close()
    }
  })()
  yield* ch
  await run
}
