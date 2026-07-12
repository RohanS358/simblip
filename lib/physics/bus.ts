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
  if (buf.samples.length > CAPACITY) buf.samples.splice(0, buf.samples.length - CAPACITY)
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

/** Min/max-preserving decimation so oscillation peaks survive downsampling. */
export function decimate(samples: Sample[], maxPoints: number): Sample[] {
  if (samples.length <= maxPoints) return samples
  const bucketSize = Math.ceil(samples.length / (maxPoints / 2))
  const out: Sample[] = []
  const key = samples[0] ? Object.keys(samples[0].channels)[0] : undefined
  for (let i = 0; i < samples.length; i += bucketSize) {
    const bucket = samples.slice(i, i + bucketSize)
    if (!key) {
      out.push(bucket[0])
      continue
    }
    let min = bucket[0]
    let max = bucket[0]
    for (const s of bucket) {
      if (s.channels[key] < min.channels[key]) min = s
      if (s.channels[key] > max.channels[key]) max = s
    }
    if (min.t <= max.t) {
      out.push(min)
      if (max !== min) out.push(max)
    } else {
      out.push(max, min)
    }
  }
  return out
}
