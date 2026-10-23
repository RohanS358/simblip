// Photo / image → simulation (phase S5).
//
//   image ─▶ clean-up (grey, adaptive threshold, despeckle, thin) ─▶ strokes ─▶ the SAME reader as ink
//
// Everything after "strokes" is the sketch pipeline (splitting, SketchNet, wiring, values, the ghost preview
// and Make it live), so a photographed circuit gets the preview, the corrections and the failure cards a
// drawn one does. No extra model is shipped for it.
//
// Pure and DOM-free: the caller decodes the picture to RGBA (a canvas, or a test generator).

import { readSketch, type PlainStroke, type ReadResult } from '../read-sketch'
import type { startCircuitGhost } from '../circuit-ghost'
import { despeckle, downscale, countInk, threshold, thin, toGrey, type Mask, type RgbaImage } from './raster'
import { traceStrokes } from './trace'
import { DEFAULT_BUDGET_MS, makeBudget, PhotoRefused } from './budget'

export type { RgbaImage } from './raster'

type Net = Parameters<typeof startCircuitGhost>[2]

export interface PhotoInk {
  strokes: PlainStroke[]
  /** Working size (after downscaling) the stroke coordinates are in. */
  width: number
  height: number
  /** Scale from the original picture to the working size (≤ 1). */
  scale: number
  strokeWidth: number
  dots: number
  /** Share of the picture that is ink: near 0 means a blank page, high means a photo of something else. */
  inkShare: number
}

/** The picture as pen strokes, or null with the reason when there is nothing readable in it. */
export function photoToInk(img: RgbaImage, opts: { budgetMs?: number } = {}): { ink: PhotoInk } | { error: string } {
  if (img.width < 24 || img.height < 24) return { error: 'The picture is too small to read.' }
  const g0 = toGrey(img)
  const { grey, w, h, scale } = downscale(g0, img.width, img.height)
  const mask: Mask = threshold(grey, w, h)
  despeckle(mask, Math.max(6, Math.round((w * h) / 60000)))
  const inkPx = countInk(mask)
  const inkShare = inkPx / (w * h)
  if (inkPx < 40) return { error: 'I could not find any drawing in the picture. Is it a dark drawing on light paper, in focus?' }
  if (inkShare > 0.35) return { error: 'The picture is mostly dark, so there is no line drawing to read. Photograph a diagram on light paper, with even light.' }
  const thick: Mask = { w, h, px: mask.px.slice() }
  const budget = makeBudget(opts.budgetMs ?? DEFAULT_BUDGET_MS)
  try {
    thin(mask, budget)
    const t = traceStrokes(thick, mask, budget)
    if (t.strokes.length === 0) return { error: 'I found marks but no lines I could follow.' }
    return { ink: { strokes: t.strokes, width: w, height: h, scale, strokeWidth: t.strokeWidth, dots: t.dots, inkShare } }
  } catch (e) {
    // a refusal says what to do; anything else is a bug and must not be hidden as one
    if (e instanceof PhotoRefused) return { error: e.message }
    throw e
  }
}

export interface PhotoReading {
  ink: PhotoInk
  result: ReadResult
}

/** Read a photographed diagram with the sketch reader. */
export function readPhoto(
  img: RgbaImage,
  net: Net | null,
  charNet?: Net,
  pageId = 'photo',
  /** Where the picture sits on the page (x, y = its corner; k = page px per picture px). The reading then lands on the picture. */
  place?: { x: number; y: number; k: number },
  opts: { budgetMs?: number; domain?: 'auto' | 'circuit' } = {}
): PhotoReading | { error: string } {
  const r = photoToInk(img, opts)
  if ('error' in r) return r
  // `place.k` is page px per ORIGINAL picture px; the strokes are in working px (the picture shrunk by `scale`)
  const kk = place ? place.k / r.ink.scale : 1
  const strokes = place
    ? r.ink.strokes.map((s) => ({ id: s.id, pts: s.pts.map(([x, y]) => [place.x + kk * x, place.y + kk * y]) }))
    : r.ink.strokes
  // the seed only names "which drawing"; a photo is one drawing, so the longest stroke will do
  const seed = strokes.reduce((a, b) => (b.pts.length > a.pts.length ? b : a))
  // A picture is read as a circuit unless the caller says 'auto' (the picture's button says "Read as circuit"): the
  // loops of a hand-drawn coil and the teeth of a zigzag look like lenses and hinges to the other readers.
  const result = readSketch(pageId, strokes, seed.id, net, charNet, { all: true, domain: opts.domain ?? 'circuit' })
  return { ink: r.ink, result }
}
