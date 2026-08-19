'use client'

// Where AI output lands on a page.
//
// Extracted from the AI panel's onAdd handler so it can be tested without a
// DOM: the arithmetic is the whole bug surface, and it was wrong in a way
// nothing could catch by eye.
//
// Reported: "when I add simulation to slides, it goes out of the visible
// slide". Two independent causes, both fixed here:
//
//   1. The scene was placed BESIDE the answer, at origin.x + column + 80.
//      On a 960px-wide slide a 520px answer column plus that gap starts the
//      scene at x≈600 — half of it hangs off the right edge. Side-by-side is
//      right on an infinite board and wrong in a fixed frame.
//   2. Nothing clamped the result to the page. Even centred content can
//      overhang when it is simply taller or wider than the frame, and on a
//      slide "outside the frame" means invisible: it does not render in
//      Present mode and it does not survive export.
//
// The frame itself comes from viewportBounds (lib/scene/insertables.ts),
// which now returns a slide's fixed 960×540 rather than the scrolled
// viewport.

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Size {
  w: number
  h: number
}

/** Gap between the answer column and the scene beside/below it. */
const GAP = 80

/** Assumed scene footprint when laying out beside/below an answer. A script's
 *  true extent is only knowable by running it, so this is the planning figure
 *  — deliberately close to the system box the corpus tells the model to use
 *  (460×360 plus room for a slider/graph under it). */
const SCENE: Size = { w: 520, h: 400 }

/**
 * Keep a box of `size` inside `b`.
 *
 * Clamps the far edge first, then the near edge, so a box LARGER than the
 * frame ends up flush at left/top (showing its beginning) rather than
 * centred with both ends cut off — for a column of notes the top is the part
 * worth seeing.
 */
export function clampToBounds(pos: { x: number; y: number }, size: Size, b: Bounds): { x: number; y: number } {
  return {
    x: finite(Math.max(b.left, Math.min(pos.x, b.right - size.w)), 0),
    y: finite(Math.max(b.top, Math.min(pos.y, b.bottom - size.h)), 0),
  }
}

/**
 * Guarantee a real number reaches the store.
 *
 * Every coordinate this module produces is arithmetic over `Bounds`, and a
 * single non-finite edge poisons the whole expression: Math.max(NaN, …) is
 * NaN, which the store serialises to `null`. A null position is far worse
 * than a wrong one — it renders at left:0 AND slips through every bounds
 * check downstream (`null > right` is false), so the object is silently
 * off-frame with nothing reporting it out of bounds.
 *
 * Measured: an AI-built pendulum whose length slider was scripted at x:60
 * arrived on the canvas with position.x === null and rendered ~1000px right
 * of its system box, off the visible area. viewportBounds() had handed back
 * a NaN edge (a viewport entry with zoom 0/undefined divides to NaN), and
 * nothing between there and the store rejected it.
 *
 * Clamping to a finite fallback keeps the object visible and, more
 * importantly, keeps it CHECKABLE by the callers that verify placement.
 */
function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback
}

/**
 * Origins for an answer column and (optionally) a scene beside or below it.
 *
 * Side by side when the frame is wide enough for both, stacked when it is
 * not — a slide is 960px, so a 520px column plus a 520px scene cannot sit
 * side by side there, while a board has all the room in the world.
 *
 * Every returned origin is clamped into `b`.
 */
export function placeAnswerAndScene(
  answer: Size | null,
  hasScene: boolean,
  b: Bounds
): { answer?: { x: number; y: number }; scene?: { x: number; y: number } } {
  const frameW = b.right - b.left
  const frameH = b.bottom - b.top
  const cx = (b.left + b.right) / 2
  const cy = (b.top + b.bottom) / 2

  // Scene only: centre it.
  if (!answer) {
    if (!hasScene) return {}
    return { scene: clampToBounds({ x: cx - SCENE.w / 2, y: cy - SCENE.h / 2 }, SCENE, b) }
  }

  // Answer only: centre it, or pin to the top when it is taller than the
  // frame (a long derivation) so it reads from its first line.
  if (!hasScene) {
    const y = answer.h <= frameH ? cy - answer.h / 2 : b.top
    return { answer: clampToBounds({ x: cx - answer.w / 2, y }, answer, b) }
  }

  // Both. Prefer side by side; fall back to stacking in a narrow frame.
  const sideBySide = answer.w + GAP + SCENE.w <= frameW
  if (sideBySide) {
    const totalW = answer.w + GAP + SCENE.w
    const x0 = cx - totalW / 2
    const top = Math.max(b.top, cy - Math.max(answer.h, SCENE.h) / 2)
    return {
      answer: clampToBounds({ x: x0, y: top }, answer, b),
      scene: clampToBounds({ x: x0 + answer.w + GAP, y: top }, SCENE, b),
    }
  }

  // Stacked: answer on top, scene under it.
  //
  // When the pair is taller than the frame, the gap closes first — 80px of
  // whitespace is the cheapest thing to give up. If it still does not fit,
  // the scene is placed below the answer ANYWAY, past the frame's bottom
  // edge, rather than clamped up into it: clamping there would slide the
  // scene back over the answer and draw the two on top of each other, which
  // is strictly worse than content the user can scroll or move. Overlap
  // destroys both; overflow keeps both readable.
  const gap = answer.h + GAP + SCENE.h <= frameH ? GAP : 24
  const totalH = answer.h + gap + SCENE.h
  const y0 = totalH <= frameH ? cy - totalH / 2 : b.top
  const answerPos = clampToBounds({ x: cx - answer.w / 2, y: y0 }, answer, b)
  // Where the scene sits if it simply follows the answer, and the highest it
  // could be pulled to without landing on top of it.
  const below = answerPos.y + answer.h + gap
  const floor = answerPos.y + answer.h
  return {
    answer: answerPos,
    // Horizontal always clamps — width is what actually runs off a slide.
    scene: {
      x: clampToBounds({ x: cx - SCENE.w / 2, y: 0 }, SCENE, b).x,
      y: Math.max(floor, Math.min(below, b.bottom - SCENE.h)),
    },
  }
}
