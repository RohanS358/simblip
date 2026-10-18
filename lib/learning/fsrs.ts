// FSRS-4.5 spaced-repetition scheduler (Free Spaced Repetition Scheduler).
// Hand-rolled — ~60 lines, no model, no dependency (docs/ai-plans, §6.2).
// Pure: importable from Node tests and the browser.

export type Rating = 1 | 2 | 3 | 4 // Again · Hard · Good · Easy

export interface Fsrs {
  difficulty: number
  stability: number // days until recall probability falls to 90%
  due: number // epoch ms
  reps: number
  lapses: number
  last: number // epoch ms of last review; 0 = never reviewed
}

// Published FSRS-4.5 default parameters.
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755]
const DAY = 86_400_000
const FACTOR = 19 / 81
const clampD = (d: number) => Math.min(10, Math.max(1, d))

/** Probability of recalling a card `days` after its last review. */
export const retrievability = (days: number, stability: number) => Math.pow(1 + (FACTOR * Math.max(0, days)) / stability, -0.5)

const interval = (s: number) => Math.max(1, Math.round((s / FACTOR) * (Math.pow(0.9, -2) - 1))) // desired retention 0.9

export const newFsrs = (now: number): Fsrs => ({ difficulty: 0, stability: 0, due: now, reps: 0, lapses: 0, last: 0 })

export function review(c: Fsrs, rating: Rating, now: number): Fsrs {
  if (c.reps === 0) {
    const stability = W[rating - 1]
    const difficulty = clampD(W[4] - (rating - 3) * W[5])
    return { difficulty, stability, due: now + (rating === 1 ? 0.007 * DAY : interval(stability) * DAY), reps: 1, lapses: rating === 1 ? 1 : 0, last: now }
  }
  const r = retrievability((now - c.last) / DAY, c.stability)
  const d0 = W[4] - (3 - 3) * W[5]
  const difficulty = clampD(W[7] * d0 + (1 - W[7]) * (c.difficulty - W[6] * (rating - 3)))
  let stability: number
  if (rating === 1) {
    stability = Math.min(c.stability, W[11] * Math.pow(c.difficulty, -W[12]) * (Math.pow(c.stability + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)))
  } else {
    const hard = rating === 2 ? W[15] : 1
    const easy = rating === 4 ? W[16] : 1
    stability = c.stability * (1 + Math.exp(W[8]) * (11 - c.difficulty) * Math.pow(c.stability, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy)
  }
  return {
    difficulty,
    stability,
    due: now + (rating === 1 ? 0.007 * DAY : interval(stability) * DAY), // Again: back in ~10 min
    reps: c.reps + 1,
    lapses: c.lapses + (rating === 1 ? 1 : 0),
    last: now,
  }
}
