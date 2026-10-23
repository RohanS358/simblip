// Limits for reading a picture. A photo of graph paper, a page of text or a busy scene has no circuit in it,
// and tracing it used to take minutes (and then froze the page when the worker's fallback ran the same work
// again). Two guards, both ending in a plain message to the person:
//   • LIMITS: a picture that yields more separate lines than any real diagram is refused up front;
//   • Budget: whatever slips through is stopped at a deadline, wherever the work happens to be.

export class PhotoRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoRefused'
  }
}

/** More separate line pieces than this is graph paper, handwriting or a scene, not a diagram. */
export const MAX_LINE_PIECES = 1200
/** More strokes than this after joining would take the reader seconds, for a drawing that is not one. */
export const MAX_STROKES = 300
/** Default time a picture may take to become strokes, ms. */
export const DEFAULT_BUDGET_MS = 10_000

export interface Budget {
  /** Throws PhotoRefused once the deadline has passed. Cheap enough to call in a loop. */
  check(): void
}

export function makeBudget(ms: number = DEFAULT_BUDGET_MS, now: () => number = () => performance.now()): Budget {
  const deadline = now() + ms
  let n = 0
  return {
    check() {
      // look at the clock every 64th call: this is called from inner loops
      if ((++n & 63) !== 0) return
      if (now() > deadline) {
        throw new PhotoRefused(`This picture is too busy to read (it took longer than ${Math.round(ms / 1000)} seconds). Photograph just the circuit, on plain paper.`)
      }
    },
  }
}

export const NO_BUDGET: Budget = { check() {} }

export const TOO_BUSY_MESSAGE =
  'This picture has far more lines than a circuit diagram (graph paper, a page of text or a busy scene?). Photograph just the circuit, on plain paper.'
