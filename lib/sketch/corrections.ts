// Real examples that fall out of normal use: every time someone confirms or
// corrects a ghost preview, the strokes and the label they settled on are saved
// here, ON THIS DEVICE, in the same record format as every other sketch sample
// (dataset.ts) with source "real".
//
// Nothing here uploads anything. The records leave the device only when the
// user exports them (Pen settings → Saved corrections), and any upload to a
// shared model needs the explicit consent in docs/ai/sketch-consent.md. The
// writer id is a random code made on this device — no name, no account.
//
// Why it exists: a model that only ever saw generated hands can't be checked
// against people. These are the people.

import { SketchSample, type SketchSampleT } from './dataset'
import { canonicalPose, type Pose } from './classes'

export const CORRECTIONS_KEY = 'simblip-sketch-corrections'
export const WRITER_KEY = 'simblip-sketch-writer'
/** Oldest records are dropped beyond this, so storage can't grow without bound. */
export const MAX_CORRECTIONS = 400
/** Strokes are thinned to at most this many points each before saving. */
const MAX_POINTS = 64

/** The slice of localStorage this module needs — injectable so it is testable. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type Device = SketchSampleT['device']

export interface CorrectionInput {
  cls: string
  pose: Pose
  /** Strokes of [x, y, …]; any extra columns (pressure) are ignored. */
  strokes: number[][][]
  device: Device
  /** What the model said, and how sure it was. */
  predicted: string
  confidence: number
  /** The user picked a different class than the model's first guess. */
  changed: boolean
  /** The user rotated it. */
  rotated: boolean
}

/** Random, device-local, anonymous. Created on first use and kept. */
export function writerId(store: KeyValueStore, rand: () => number = Math.random): string {
  const have = store.getItem(WRITER_KEY)
  if (have) return have
  const id = 'anon-' + Array.from({ length: 10 }, () => Math.floor(rand() * 36).toString(36)).join('')
  store.setItem(WRITER_KEY, id)
  return id
}

function thin(stroke: number[][]): Array<[number, number, number]> {
  const step = Math.max(1, Math.ceil(stroke.length / MAX_POINTS))
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < stroke.length; i += step) out.push([round1(stroke[i][0]), round1(stroke[i][1]), 0])
  const last = stroke[stroke.length - 1]
  if (out.length && (out[out.length - 1][0] !== round1(last[0]) || out[out.length - 1][1] !== round1(last[1]))) {
    out.push([round1(last[0]), round1(last[1]), 0])
  }
  return out
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * One saved example. The canvas keeps no timestamps for committed ink, so `t`
 * is a placeholder (8 ms per point) and `meta.timing` says so; SketchNet does
 * not use time.
 */
export function makeCorrection(input: CorrectionInput, writer: string, now: number = Date.now()): SketchSampleT {
  let t = 0
  const strokes = input.strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      const pts = thin(s).map(([x, y]): [number, number, number] => [x, y, (t += 8)])
      t += 200 // a pen-up gap between strokes
      return pts
    })
  return {
    id: `real-${writer}-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    cls: input.cls,
    pose: canonicalPose(input.cls, input.pose),
    strokes: strokes.map((s) => s.map(([x, y, tt]): [number, number, number] => [x, y, tt - strokes[0][0][2]])),
    source: 'real',
    writer,
    device: input.device,
    // One person is one writer, so a real sample is never trained on unless an
    // export step deliberately makes a split; it starts as held-out test data.
    split: 'test',
    meta: {
      app: 'ghost-v1',
      predicted: input.predicted,
      confidence: Math.round(input.confidence * 1000) / 1000,
      changed: input.changed,
      rotated: input.rotated,
      timing: 'placeholder',
      storage: 'local-only',
    },
  }
}

export function loadCorrections(store: KeyValueStore): SketchSampleT[] {
  try {
    const raw = store.getItem(CORRECTIONS_KEY)
    if (!raw) return []
    const rows = JSON.parse(raw) as unknown[]
    return rows.flatMap((r) => {
      const p = SketchSample.safeParse(r)
      return p.success ? [p.data] : []
    })
  } catch {
    return []
  }
}

/** Append one example (newest last), dropping the oldest past the cap. Never throws. */
export function addCorrection(store: KeyValueStore, sample: SketchSampleT): number {
  try {
    const all = [...loadCorrections(store), sample].slice(-MAX_CORRECTIONS)
    store.setItem(CORRECTIONS_KEY, JSON.stringify(all))
    return all.length
  } catch {
    return 0 // storage full or blocked: the feature must keep working without it
  }
}

export function clearCorrections(store: KeyValueStore): void {
  try {
    store.removeItem(CORRECTIONS_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** Line-delimited JSON, ready for scripts/ai/sketch/import-real.mjs. */
export function toJsonl(samples: SketchSampleT[]): string {
  return samples.map((s) => JSON.stringify(s)).join('\n') + (samples.length ? '\n' : '')
}
