// Font-size clamping shared by the Properties panel's numeric field and its
// ±1px stepper (components/workspace/inspector.tsx). Extracted so the
// arithmetic is testable without a React harness.

export const MIN_FONT_PX = 6
export const MAX_FONT_PX = 200

/** Parses and clamps a typed size. Returns null for anything non-numeric,
 *  which the caller treats as "ignore this input" rather than as a size. */
export function clampFontPx(value) {
  // Number('') is 0, not NaN — so a bare isFinite() check accepts an empty
  // (or whitespace) field and clamps it to the 6px floor, silently shrinking
  // the user's text to nothing. Reject blanks before converting.
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, Math.round(n)))
}

/** One step of the ±1px stepper, from the size currently shown. */
export function stepFontPx(current, delta) {
  return clampFontPx(current + delta)
}

/** What the Size field displays, given the selection's measured size.
 *
 *  `selectionPx` is null when there is no single answer — a selection
 *  spanning several sizes. It must NEVER fall back to a remembered
 *  "last applied" value: doing so made the panel report 22px for text that
 *  was never 22, and the stepper then applied 21/23 to it. Blank is the
 *  honest answer, and the stepper is disabled on it. */
export function shownFontPx(selectionPx, boxPx = null) {
  if (selectionPx !== null && selectionPx !== undefined) return selectionPx
  // No live editor (box selected, not being edited): the whole-box size is a
  // real value to show and step from.
  return boxPx ?? null
}

/** Whether the ±1px buttons are usable for a given shown size. */
export function canStep(shown, delta) {
  if (shown === null) return false
  return delta < 0 ? shown > MIN_FONT_PX : shown < MAX_FONT_PX
}
