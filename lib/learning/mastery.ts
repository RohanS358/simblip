// Mastery: exponentially-weighted accuracy per concept, bumped down by hint rung
// (docs/ai-plans §6.5). Deterministic; the model never computes it.
import type { Rung } from './hints'

export interface Mastery { conceptId: string; p: number; evidence: number; updatedAt: number }

const ALPHA = 0.3
/** Credit earned by a correct answer at each hint rung. */
const CREDIT = [1, 1, 0.85, 0.6, 0.3]

export function updateMastery(m: Mastery | undefined, conceptId: string, correct: boolean, hintRung: Rung | undefined, now: number): Mastery {
  const prev = m?.p ?? 0.3 // unknown ≈ "probably not yet"
  const x = correct ? CREDIT[hintRung ?? 0] : 0
  return { conceptId, p: prev + ALPHA * (x - prev), evidence: (m?.evidence ?? 0) + 1, updatedAt: now }
}

/** Weakest first; concepts with no evidence come before anything mastered. */
export const weakest = (ms: Mastery[], n: number) => [...ms].sort((a, b) => a.p - b.p).slice(0, n)
