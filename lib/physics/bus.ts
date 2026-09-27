// Simulation bus: per-object ring buffers living OUTSIDE React.
// Physics writes at 120 Hz; graphs read at ≤15 Hz. React state is never
// touched by the hot loop (see docs/graph-engine.md).

export interface Sample {
  t: number
  channels: Record<string, number>
}

const CAPACITY = 2400 // ~40 s at 60 Hz sampling

interface Buffer {
  samples: Sample[]
  version: number
  channelNames: string[]
}

const buffers = new Map<string, Buffer>()
const listeners = new Map<string, Set<() => void>>()

export function pushSample(objectId: string, sample: Sample) {
  let buf = buffers.get(objectId)
  if (!buf) {
    buf = { samples: [], version: 0, channelNames: Object.keys(sample.channels) }
    buffers.set(objectId, buf)
  }
  buf.samples.push(sample)
  // Trim in chunks: splicing ONE sample off the front at 120 Hz shifted the
  // whole 2400-entry array every tick. Readers just see ≤ 25% more history.
  if (buf.samples.length > CAPACITY * 1.25) buf.samples.splice(0, buf.samples.length - CAPACITY)
  buf.version++
  buf.channelNames = Object.keys(sample.channels)
}

export function clearBuffer(objectId: string) {
  const buf = buffers.get(objectId)
  if (buf) {
    buf.samples = []
    buf.version++
  }
  notify(objectId)
}

/** Forget an object's samples entirely — called when its page leaves memory
 *  (clearBuffer only empties the buffer; this releases it). */
export function dropBuffer(objectId: string) {
  buffers.delete(objectId)
  notify(objectId)
}

export function readBuffer(objectId: string): Buffer | undefined {
  return buffers.get(objectId)
}

export function subscribe(objectId: string, fn: () => void): () => void {
  let set = listeners.get(objectId)
  if (!set) {
    set = new Set()
    listeners.set(objectId, set)
  }
  set.add(fn)
  return () => set!.delete(fn)
}

export function notify(objectId: string) {
  listeners.get(objectId)?.forEach((fn) => fn())
}

/** Min/max-preserving decimation so oscillation peaks survive downsampling —
 *  on EVERY channel, not just the first (a graph of vx beside x used to
 *  alias its peaks away because only x's extremes were kept). Output is in
 *  time order and never exceeds roughly maxPoints. */
export function decimate(samples: Sample[], maxPoints: number, only?: string[]): Sample[] {
  if (samples.length <= maxPoints) return samples
  const all = samples[0] ? Object.keys(samples[0].channels) : []
  const keys = only?.length ? all.filter((k) => only.includes(k)) : all
  if (keys.length === 0) {
    const step = Math.ceil(samples.length / maxPoints)
    return samples.filter((_, i) => i % step === 0)
  }
  // Each bucket contributes up to 2 samples per channel; size the buckets so
  // the total stays near maxPoints (channels sharing extremes dedupe).
  const perBucket = 2 * Math.min(keys.length, 4)
  const buckets = Math.max(8, Math.floor(maxPoints / perBucket))
  const bucketSize = Math.ceil(samples.length / buckets)
  const out: Sample[] = []
  const picked = new Set<number>()
  for (let i = 0; i < samples.length; i += bucketSize) {
    const end = Math.min(samples.length, i + bucketSize)
    picked.clear()
    picked.add(i)
    for (const key of keys) {
      let lo = i
      let hi = i
      for (let j = i + 1; j < end; j++) {
        const v = samples[j].channels[key]
        if (v < samples[lo].channels[key]) lo = j
        if (v > samples[hi].channels[key]) hi = j
      }
      picked.add(lo)
      picked.add(hi)
    }
    for (const j of [...picked].sort((a, b) => a - b)) out.push(samples[j])
  }
  return out
}
