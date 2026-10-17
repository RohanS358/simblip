// The ONE record format every sketch sample uses, wherever it came from.
//
// Synthetic generator, a classroom collection session, a public dataset: all
// emit these records, differing only in `source`. Training and evaluation read
// records without caring where they came from, EXCEPT that every metric is
// reported per source — a synthetic score never stands in for a real one.
// Adding real data later is therefore a new shard on disk, not a pipeline change.

import { z } from 'zod'

/** Where a sample came from. Metrics are always grouped by this. */
export const SAMPLE_SOURCES = ['synthetic', 'synthetic-negative', 'real', 'public'] as const
export const DEVICES = ['mouse', 'touchpad', 'finger', 'pen'] as const

export const SketchSample = z.object({
  id: z.string(),
  /** A WAVE1_CLASSES id or 'unknown'. */
  cls: z.string(),
  /** Canonical pose (see canonicalPose); 0 for classes with no meaningful pose. */
  pose: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  /** Strokes of [x, y, t] — page pixels and milliseconds from the first point. */
  strokes: z.array(z.array(z.tuple([z.number(), z.number(), z.number()]))).min(1),
  source: z.enum(SAMPLE_SOURCES),
  /** Anonymous writer id. Splits are made by writer, never by sample. */
  writer: z.string(),
  device: z.enum(DEVICES),
  split: z.enum(['train', 'val', 'test']),
  /** Free-form provenance: generator version, glyph variant, consent version… */
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

export type SketchSampleT = z.infer<typeof SketchSample>

/** A shard's line-delimited JSON → samples, validating every line. */
export function parseShard(text: string): SketchSampleT[] {
  const out: SketchSampleT[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const r = SketchSample.safeParse(JSON.parse(lines[i]))
    if (!r.success) throw new Error(`shard line ${i + 1}: ${r.error.issues[0]?.message ?? 'invalid sample'}`)
    out.push(r.data)
  }
  return out
}
