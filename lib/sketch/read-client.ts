// Ask the reader worker to read a sketch; fall back to reading on this thread if a worker cannot be
// had (old browser, blocked, crashed, or too slow). Always resolves — a read never hangs the UI.

import { readSketch, type PlainStroke, type ReadResult } from './read-sketch'
import { readPhoto } from './photo'
import { peekInkChars, peekSketchNet, sketchNetFailed } from './sketchnet'
import type { ReadReply, ReadRequest } from './read-worker'

/** Give up on the worker after this long and read here instead. */
export const WORKER_TIMEOUT_MS = 20000

/** Built from read-worker.ts by scripts/build-sketch-worker.mjs (predev / prebuild). */
export const WORKER_URL = '/workers/sketch-read.js'

let worker: Worker | null = null
let broken = false
let nextId = 1
const waiting = new Map<number, { resolve: (r: ReadResult) => void; fallback: () => ReadResult; timer: ReturnType<typeof setTimeout> }>()

/** The read on this thread, with the honest reason when the recogniser could not be downloaded. */
export function readHere(pageId: string, strokes: PlainStroke[], seedId: string): ReadResult {
  const net = peekSketchNet()
  if (!net && sketchNetFailed()) {
    return { kind: 'fail', failure: { reason: 'not-loaded', message: "The sketch recogniser couldn't be downloaded. Check your connection and press Try again." } }
  }
  return readSketch(pageId, strokes, seedId, net, peekInkChars() ?? undefined)
}

function dropWorker(): void {
  broken = true
  try { worker?.terminate() } catch { /* already gone */ }
  worker = null
  // whatever was in flight is read here instead
  for (const [id, w] of [...waiting]) {
    clearTimeout(w.timer)
    waiting.delete(id)
    queueMicrotask(() => settle(w))
  }
}

function settle(w: { resolve: (r: ReadResult) => void; fallback: () => ReadResult }): void {
  try {
    w.resolve(w.fallback())
  } catch (e) {
    w.resolve({ kind: 'fail', failure: { reason: 'error', message: `The recogniser hit an error: ${e instanceof Error ? e.message : String(e)}` } })
  }
}

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const w = new Worker(WORKER_URL)
    w.onmessage = (e: MessageEvent<ReadReply>) => {
      const hit = waiting.get(e.data.id)
      if (!hit) return
      clearTimeout(hit.timer)
      waiting.delete(e.data.id)
      if ('photoError' in e.data) hit.resolve({ kind: 'fail', failure: { reason: 'no-ink', message: e.data.photoError } })
      else if ('error' in e.data) settle(hit)
      else hit.resolve(e.data.result)
    }
    w.onerror = () => dropWorker()
    worker = w
    return w
  } catch {
    broken = true
    return null
  }
}

/** Read the sketch around `seedId` without blocking the page. */
export function readSketchAsync(pageId: string, strokes: PlainStroke[], seedId: string): Promise<ReadResult> {
  const fallback = () => readHere(pageId, strokes, seedId)
  const w = getWorker()
  if (!w) return new Promise((resolve) => setTimeout(() => settle({ resolve, fallback }), 0))
  return new Promise((resolve) => {
    const id = nextId++
    const timer = setTimeout(() => {
      waiting.delete(id)
      settle({ resolve, fallback })
    }, WORKER_TIMEOUT_MS)
    waiting.set(id, { resolve, fallback, timer })
    try {
      const req: ReadRequest = { id, pageId, strokes, seedId }
      w.postMessage(req)
    } catch {
      clearTimeout(timer)
      waiting.delete(id)
      dropWorker()
      settle({ resolve, fallback })
    }
  })
}

/**
 * Read a photographed diagram (decoded to RGBA) off the page's thread. `place` puts the reading on the
 * picture it came from. A picture with nothing readable in it comes back as a failure that says what to do.
 */
export function readPhotoAsync(
  pageId: string,
  image: { data: Uint8ClampedArray; width: number; height: number },
  place?: { x: number; y: number; k: number }
): Promise<ReadResult> {
  const fallback = (): ReadResult => {
    const net = peekSketchNet()
    if (!net && sketchNetFailed()) {
      return { kind: 'fail', failure: { reason: 'not-loaded', message: "The sketch recogniser couldn't be downloaded. Check your connection and press Try again." } }
    }
    const r = readPhoto(image, net, peekInkChars() ?? undefined, pageId, place)
    return 'error' in r ? { kind: 'fail', failure: { reason: 'no-ink', message: r.error } } : r.result
  }
  const w = getWorker()
  if (!w) return new Promise((resolve) => setTimeout(() => settle({ resolve, fallback }), 0))
  return new Promise((resolve) => {
    const id = nextId++
    const timer = setTimeout(() => {
      waiting.delete(id)
      settle({ resolve, fallback })
    }, WORKER_TIMEOUT_MS * 2)
    waiting.set(id, { resolve, fallback, timer })
    try {
      const copy = new Uint8ClampedArray(image.data) // the caller keeps its pixels
      const req: ReadRequest = { id, pageId, strokes: [], seedId: '', photo: { image: { data: copy, width: image.width, height: image.height }, place } }
      w.postMessage(req, [copy.buffer])
    } catch {
      clearTimeout(timer)
      waiting.delete(id)
      dropWorker()
      settle({ resolve, fallback })
    }
  })
}
