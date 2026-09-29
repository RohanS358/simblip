// Auto pen: a tiny rule table that picks the pen style for the stroke about to
// start, from where the pen is and what the user just did — so nobody has to
// keep swapping pens. Pure: the canvas gathers the facts, this decides.
//
//   1. Presenting / a sim is running     → pointer (fading laser ink)
//   2. Marking up a run of doc text      → highlighter
//   3. Chaining strokes (< CHAIN_MS)     → keep the last auto pick, so a
//      highlighter doesn't flip to ink in the gap between two words
//   4. Otherwise a stylus (pressure)     → ink; a mouse (no pressure) → pen
//
// A style the user picked by hand always wins for MANUAL_HOLD_MS.

import type { PenStyle } from '@/lib/store/preferences'

export const CHAIN_MS = 6000
export const MANUAL_HOLD_MS = 30_000

export interface PenContext {
  now: number
  pointerType: string
  /** a simulation is running or paused on this page */
  running: boolean
  /** pen went down over a run of text in a document */
  overText: boolean
  /** style currently selected in the pen prefs */
  current: PenStyle
  /** what auto last set, and when the last auto-handled stroke began */
  lastAuto: PenStyle | null
  lastStrokeAt: number
  /** when the user last changed the style by hand (0 = never) */
  manualAt: number
}

export function choosePenStyle(c: PenContext): PenStyle {
  if (c.manualAt && c.now - c.manualAt < MANUAL_HOLD_MS) return c.current
  if (c.running) return 'pointer'
  if (c.overText) return 'highlighter'
  if (c.lastAuto === 'highlighter' && c.now - c.lastStrokeAt < CHAIN_MS) return 'highlighter'
  return c.pointerType === 'pen' ? 'ink' : 'pen'
}
