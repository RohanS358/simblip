// Ask the reader worker to read a sketch or a photographed diagram.
//
// The page never does this work itself unless it has no choice:
//   • no Worker in this browser, or the worker script failed to load → read on this thread (a photo with a
//     short deadline, so even this cannot hold the page for long);
//   • the worker is TOO SLOW → it is terminated and the read fails with a message. It is NOT repeated on
//     this thread: that used to run the same minutes-long work again on the page and freeze the tab, and
//     left the stuck worker running behind every later read. A fresh worker starts with the next request.
// Every call resolves; a read never hangs the UI.

import { readSketch, type PlainStroke, type ReadResult } from './read-sketch'
import { readPhoto } from './photo'
import { peekInkChars, peekSketchNet, sketchNetFailed } from './sketchnet'
import type { ReadReply, ReadRequest } from './read-worker'

/** How long the worker may take over a sketch before it is stopped, ms. */
export const WORKER_TIMEOUT_MS = 20000
/** … over a picture (decoding, tracing and reading), ms. */
export const PHOTO_TIMEOUT_MS = 40000
/** Deadline for turning a picture into strokes when it has to be done on the page's own thread, ms. */
export const FALLBACK_PHOTO_BUDGET_MS = 4000
/** Deadline the worker gives itself for turning a picture into strokes, ms. */
export const WORKER_PHOTO_BUDGET_MS = 12000

/** Built from read-worker.ts by scripts/build-sketch-worker.mjs (predev / prebuild). */
export const WORKER_URL = '/workers/sketch-read.js'

type Resolve = (r: ReadResult) => void
interface Pending {
  resolve: Resolve
  /** the same read on this thread, for when no worker can be had */
  fallback: () => ReadResult
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
/** The worker script cannot run here (failed to load / crashed): read on this thread from now on. */
let broken = false
let nextId = 1
const waiting = new Map<number, Pending>()

const notLoaded = (): ReadResult => ({
  kind: 'fail',
  failure: { reason: 'not-loaded', message: "The sketch recogniser couldn't be downloaded. Check your connection and press Try again." },
})

const tookTooLong = (ms: number): ReadResult => ({
  kind: 'fail',
  failure: {
    reason: 'error',
    message: `Reading took longer than ${Math.round(ms / 1000)} seconds, so I stopped it. Try selecting a smaller part of the drawing, or a clearer, less busy picture.`,
  },
})

/** The read on this thread, with the honest reason when the recogniser could not be downloaded. */
export function readHere(pageId: string, strokes: PlainStroke[], seedId: string): ReadResult {
  const net = peekSketchNet()
  if (!net && sketchNetFailed()) return notLoaded()
  return readSketch(pageId, strokes, seedId, net, peekInkChars() ?? undefined)
}

function settle(p: Pick<Pending, 'resolve' | 'fallback'>): void {
  try {
    p.resolve(p.fallback())
  } catch (e) {
    p.resolve({ kind: 'fail', failure: { reason: 'error', message: `The recogniser hit an error: ${e instanceof Error ? e.message : String(e)}` } })
  }
}

function endWorker(): void {
  try {
    worker?.terminate()
  } catch {
    /* already gone */
  }
  worker = null
}

/** The worker cannot be used at all: whatever was in flight is read here instead, and later reads start here too. */
function workerBroken(): void {
  broken = true
  endWorker()
  for (const [id, p] of [...waiting]) {
    clearTimeout(p.timer)
    waiting.delete(id)
    queueMicrotask(() => settle(p))
  }
}

/** The worker took too long: stop it, tell everyone waiting on it, and let the next request start a new one. */
function workerTooSlow(ms: number): void {
  endWorker()
  const result = tookTooLong(ms)
  for (const [id, p] of [...waiting]) {
    clearTimeout(p.timer)
    waiting.delete(id)
    p.resolve(result)
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
    w.onerror = () => workerBroken()
    worker = w
    return w
  } catch {
    broken = true
    return null
  }
}

function send(req: Omit<ReadRequest, 'id'>, fallback: () => ReadResult, timeoutMs: number, transfer: Transferable[] = []): Promise<ReadResult> {
  const w = getWorker()
  if (!w) return new Promise((resolve) => setTimeout(() => settle({ resolve, fallback }), 0))
  return new Promise((resolve) => {
    const id = nextId++
    const timer = setTimeout(() => workerTooSlow(timeoutMs), timeoutMs)
    waiting.set(id, { resolve, fallback, timer })
    try {
      w.postMessage({ ...req, id } satisfies ReadRequest, transfer)
    } catch {
      clearTimeout(timer)
      waiting.delete(id)
      workerBroken()
      settle({ resolve, fallback })
    }
  })
}

/** Read the sketch around `seedId` without blocking the page. */
export function readSketchAsync(pageId: string, strokes: PlainStroke[], seedId: string, opts: { timeoutMs?: number } = {}): Promise<ReadResult> {
  return send({ pageId, strokes, seedId }, () => readHere(pageId, strokes, seedId), opts.timeoutMs ?? WORKER_TIMEOUT_MS)
}

/**
 * Read a photographed diagram (decoded to RGBA) off the page's thread. `place` puts the reading on the
 * picture it came from. A picture with nothing readable in it (or too busy to be a diagram) comes back as a
 * failure that says what to do.
 */
export function readPhotoAsync(
  pageId: string,
  image: { data: Uint8ClampedArray; width: number; height: number },
  place?: { x: number; y: number; k: number },
  opts: { timeoutMs?: number } = {}
): Promise<ReadResult> {
  const fallback = (): ReadResult => {
    const net = peekSketchNet()
    if (!net && sketchNetFailed()) return notLoaded()
    const r = readPhoto(image, net, peekInkChars() ?? undefined, pageId, place, { budgetMs: FALLBACK_PHOTO_BUDGET_MS })
    return 'error' in r ? { kind: 'fail', failure: { reason: 'no-ink', message: r.error } } : r.result
  }
  const copy = new Uint8ClampedArray(image.data) // the caller keeps its pixels
  return send(
    { pageId, strokes: [], seedId: '', photo: { image: { data: copy, width: image.width, height: image.height }, place } },
    fallback,
    opts.timeoutMs ?? PHOTO_TIMEOUT_MS,
    [copy.buffer]
  )
}

/** Forget the worker and its state (tests). */
export function resetReadClientForTests(): void {
  endWorker()
  for (const p of waiting.values()) clearTimeout(p.timer)
  waiting.clear()
  broken = false
  nextId = 1
}
