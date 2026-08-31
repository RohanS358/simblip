'use client'

// Palm-rejection radius check, shared by hooks/use-pinch-zoom.ts (which
// already did this inline) and canvas.tsx's own pointer-based pinch (which
// didn't — it only checked the global penActive flag). Extracted so both
// read the SAME tunable radius from Settings' Gestures tab instead of one
// of them keeping a hardcoded value the setting can't reach.
//
// A palm's contact patch is much wider than a fingertip's — Touch.radiusX/
// radiusY (Chrome/WebKit) let us drop oversized contacts before pairing
// them into a gesture. radiusPx <= 0 disables the check entirely (every
// touch passes), since 0 is a valid user-chosen "off" setting.

export function isPalmTouch(touch: Touch, radiusPx: number): boolean {
  if (radiusPx <= 0) return false
  const rx = (touch as unknown as { radiusX?: number }).radiusX ?? 0
  const ry = (touch as unknown as { radiusY?: number }).radiusY ?? 0
  return Math.max(rx, ry) > radiusPx
}

/** PointerEvent flavour of the same check. PointerEvent.width/height are the
 *  contact patch's DIAMETER (Touch.radiusX/Y are radii), so halve before
 *  comparing against the same user-facing radius setting.
 *
 *  Browsers that don't measure the patch report 1×1 — which reads as a
 *  fingertip, the safe default. */
export function isPalmPointer(e: { width?: number; height?: number }, radiusPx: number): boolean {
  if (radiusPx <= 0) return false
  return Math.max(e.width ?? 0, e.height ?? 0) / 2 > radiusPx
}
