// Synthetic handwriting for the value reader: single characters drawn by the same
// simulated hands as the symbols, but smaller, slanted, and never with leads.
//
// SYNTHETIC. As with the symbols, nothing here has met real handwriting; real
// examples (confirmed values) will join through the same record format.

import { CHAR_GLYPHS, CHAR_LABELS } from './char-glyphs'
import type { SketchSampleT } from './dataset'
import { makeRng, hash32, type Rng } from './rng'
import { GENERATOR_VERSION, drawGlyphPlaced, drawNegative, makeWriter, type WriterStyle } from './synth'
import type { Stroke3 } from './synth'

export const UNKNOWN_CHAR = 'unknown'
export const CHAR_MODEL_LABELS: readonly string[] = [...CHAR_LABELS, UNKNOWN_CHAR]

/** One character as `w` writes it: a text height in px, a lean, the habits of this hand. */
export function drawChar(
  rng: Rng,
  w: WriterStyle,
  ch: (typeof CHAR_LABELS)[number],
  heightPx = rng.range(0.22, 0.5) * w.size,
  at?: { cx: number; cy: number }
): Stroke3[] {
  // a writer's own way of forming a character persists, as with symbols
  const g = CHAR_GLYPHS[ch](rng.chance(0.6) ? makeRng(hash32(`${w.id}/char/${ch}`)) : rng)
  const slant = Math.max(-0.1, Math.min(0.32, 0.1 + w.shear * 2 + rng.gauss() * 0.05))
  const drawn = drawGlyphPlaced(rng, w, g, { cx: at?.cx ?? rng.range(80, 800), cy: at?.cy ?? rng.range(80, 500), width: heightPx * 2.08, pose: 0, slant })
  if (at) return drawn.strokes // placed inside a scene: its own clock, not this character's
  const t0 = drawn.strokes[0][0][2]
  return drawn.strokes.map((s) => s.map(([x, y, t]): [number, number, number] => [x, y, t - t0]))
}

export interface CharGenOptions {
  seed: number
  writers: number
  /** Samples per writer per character. */
  reps: number
  /** 'unknown' gets this many times `reps`. */
  unknownFactor?: number
  split?: { train: number; val: number }
}

/** Every character sample for a run, writer-split, reproducible. */
export function* generateChars(opts: CharGenOptions): Generator<SketchSampleT> {
  const root = makeRng(opts.seed)
  const split = opts.split ?? { train: 0.7, val: 0.15 }
  const unknownFactor = opts.unknownFactor ?? 2
  const order = root.fork('split').shuffle(Array.from({ length: opts.writers }, (_, i) => i))
  const splitOf = new Map<number, 'train' | 'val' | 'test'>()
  order.forEach((wi, rank) => {
    const f = rank / opts.writers
    splitOf.set(wi, f < split.train ? 'train' : f < split.train + split.val ? 'val' : 'test')
  })
  for (let wi = 0; wi < opts.writers; wi++) {
    const wid = `chars-${opts.seed}-w${String(wi).padStart(4, '0')}`
    const wrng = root.fork(wid)
    const style = makeWriter(wrng, wid)
    const base = { writer: wid, device: style.device, split: splitOf.get(wi)! }
    const meta = (v: string) => ({ generator: GENERATOR_VERSION, seed: opts.seed, kind: 'char', variant: v })
    for (const ch of CHAR_LABELS) {
      for (let r = 0; r < opts.reps; r++) {
        const id = `${wid}-${ch}-${r}`
        yield { id, cls: ch, pose: 0, strokes: drawChar(wrng.fork(id), style, ch), source: 'synthetic', ...base, meta: meta(ch) }
      }
    }
    for (let r = 0; r < opts.reps * unknownFactor; r++) {
      const id = `${wid}-${UNKNOWN_CHAR}-${r}`
      const d = drawNegative(wrng.fork(id), style)
      yield { id, cls: UNKNOWN_CHAR, pose: 0, strokes: d.strokes, source: 'synthetic-negative', ...base, meta: meta(d.kind) }
    }
  }
}
