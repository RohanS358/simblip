// Seeded randomness for the synthetic-data generator. Same seed → same dataset,
// byte for byte, so a MANIFEST hash means something and a bad sample can be
// regenerated to look at it.

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  range(lo: number, hi: number): number
  int(lo: number, hi: number): number
  /** Standard normal (Box–Muller). */
  gauss(): number
  chance(p: number): boolean
  pick<T>(xs: readonly T[]): T
  /** Weighted pick: weights need not sum to 1. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T
  shuffle<T>(xs: T[]): T[]
  /** An independent stream derived from this one and a label. */
  fork(label: string): Rng
}

/** FNV-1a — turns a label into a 32-bit seed offset. */
export function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r: Rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    gauss: () => {
      let u = 0
      while (u === 0) u = next()
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
    },
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0)
      let x = next() * total
      for (const [v, w] of items) {
        x -= w
        if (x < 0) return v
      }
      return items[items.length - 1][0]
    },
    shuffle: (xs) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[xs[i], xs[j]] = [xs[j], xs[i]]
      }
      return xs
    },
    fork: (label) => makeRng((a ^ hash32(label)) >>> 0),
  }
  return r
}
