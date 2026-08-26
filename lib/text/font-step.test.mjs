// Run: node lib/text/font-step.test.mjs

import assert from 'node:assert/strict'
import {
  clampFontPx,
  stepFontPx,
  shownFontPx,
  canStep,
  MIN_FONT_PX,
  MAX_FONT_PX,
} from './font-step.mjs'

// THE REGRESSION THIS GUARDS: sizing one portion of text to 22 must not make
// every LATER selection claim to be 22. The field previously fell back to a
// staged "last applied" value, so unrelated text displayed 22 and one click
// on + applied 23 to text that had never been 22.
{
  const lastApplied = 22

  // A selection spanning several sizes has no single answer — blank, and
  // NOT the 22 left over from the previous apply.
  assert.equal(shownFontPx(null), null, 'mixed selection shows blank, not the last-applied size')
  assert.notEqual(shownFontPx(null), lastApplied)

  // ...and the stepper is disabled there, so it cannot flatten the selection.
  assert.equal(canStep(shownFontPx(null), 1), false)
  assert.equal(canStep(shownFontPx(null), -1), false)

  // A selection that really is 22 still reads 22 and steps normally.
  assert.equal(shownFontPx(22), 22)
  assert.equal(stepFontPx(shownFontPx(22), 1), 23)

  // Selecting 14px text after having applied 22 shows 14 — the size the
  // selected text actually has.
  assert.equal(shownFontPx(14), 14, 'reads the new selection, not the previous apply')
  assert.equal(stepFontPx(shownFontPx(14), 1), 15, 'steps from 14, not from 22')
}

// A merely-selected box (no live editor, so no selection to measure) falls
// back to the whole-box size, which keeps the stepper usable there.
{
  assert.equal(shownFontPx(null, 15), 15)
  assert.equal(canStep(shownFontPx(null, 15), 1), true)
}

// Bounds gate the buttons.
{
  assert.equal(canStep(MIN_FONT_PX, -1), false, 'no − at the floor')
  assert.equal(canStep(MIN_FONT_PX, 1), true)
  assert.equal(canStep(MAX_FONT_PX, 1), false, 'no + at the ceiling')
  assert.equal(canStep(MAX_FONT_PX, -1), true)
}

// One click is exactly 1px, at any starting value — including sizes typed by
// hand that sit between the named presets (12/15/20/28).
{
  assert.equal(stepFontPx(15, 1), 16)
  assert.equal(stepFontPx(15, -1), 14)
  assert.equal(stepFontPx(17, 1), 18, 'a between-presets size steps by 1, not to 20')
  assert.equal(stepFontPx(17, -1), 16, 'and does not snap down to 15')
}

// Repeated clicks compound rather than re-stepping from a stale base.
{
  let px = 15
  for (let i = 0; i < 5; i++) px = stepFontPx(px, 1)
  assert.equal(px, 20)
}

// Clamps at both ends — the stepper is disabled there, but the arithmetic
// must not run away if it is ever reached another way (typing, scrubbing).
{
  assert.equal(stepFontPx(MIN_FONT_PX, -1), MIN_FONT_PX, 'floor holds')
  assert.equal(stepFontPx(MAX_FONT_PX, 1), MAX_FONT_PX, 'ceiling holds')
  assert.equal(clampFontPx(0), MIN_FONT_PX)
  assert.equal(clampFontPx(9999), MAX_FONT_PX)
}

// Fractional sizes (a document could carry 15.5px) land on whole pixels
// rather than drifting by fractions on every click.
{
  assert.equal(stepFontPx(15.4, 1), 16)
  assert.equal(clampFontPx('15.6'), 16)
}

// Non-numeric input is ignored, not coerced to 0 — which would otherwise
// clamp to the 6px floor and silently shrink the user's text.
{
  assert.equal(clampFontPx(''), null)
  assert.equal(clampFontPx('abc'), null)
}

console.log('font-step: all checks passed')
