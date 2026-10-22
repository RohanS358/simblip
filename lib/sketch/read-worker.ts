// The reader, off the page's thread. Reading a drawing is 0.5–2 s of arithmetic; run on the main
// thread it froze the page (and the "Reading…" state with it). This worker owns its own copy of the
// networks, takes plain strokes, and sends back the plain result. No DOM, no stores.
//
// Message in:  { id, pageId, strokes, seedId }
// Message out: { id, result: ReadResult } | { id, error: string }

import { loadInkChars, loadSketchNet } from './sketchnet'
import { readSketch, type PlainStroke, type ReadResult } from './read-sketch'
import { readPhoto, type PhotoInk, type RgbaImage } from './photo'

export interface ReadRequest {
  id: number
  pageId: string
  strokes: PlainStroke[]
  seedId: string
  /** a photographed diagram instead of strokes: the picture's pixels and where it sits on the page */
  photo?: { image: { data: Uint8ClampedArray; width: number; height: number }; place?: { x: number; y: number; k: number } }
}
export type ReadReply =
  | { id: number; result: ReadResult; ms: number; ink?: Omit<PhotoInk, 'strokes'> }
  | { id: number; error: string }
  /** the picture could not be read at all (blank, too dark, too small); the words say what to do */
  | { id: number; photoError: string }

const scope = self as unknown as { onmessage: ((e: MessageEvent<ReadRequest>) => void) | null; postMessage: (m: ReadReply) => void }

scope.onmessage = async (e) => {
  const { id, pageId, strokes, seedId, photo } = e.data
  const t0 = performance.now()
  try {
    const [net, chars] = await Promise.all([loadSketchNet(), loadInkChars()])
    if (photo) {
      const r = readPhoto(photo.image as RgbaImage, net, chars ?? undefined, pageId, photo.place)
      if ('error' in r) scope.postMessage({ id, photoError: r.error })
      else {
        const { strokes: _drop, ...ink } = r.ink
        void _drop
        scope.postMessage({ id, result: r.result, ms: performance.now() - t0, ink })
      }
      return
    }
    const result: ReadResult = net
      ? readSketch(pageId, strokes, seedId, net, chars ?? undefined)
      : { kind: 'fail', failure: { reason: 'not-loaded', message: "The sketch recogniser couldn't be downloaded. Check your connection and press Try again." } }
    scope.postMessage({ id, result, ms: performance.now() - t0 })
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
