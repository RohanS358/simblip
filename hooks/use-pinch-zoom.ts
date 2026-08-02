'use client'

// Two-finger pinch on a scrollable pane → zoom callbacks, for the paged
// surfaces (DocView, PdfView) whose zoom lives outside the canvas. Touch
// events (not pointer events) so a two-finger gesture can be preventDefault-ed
// as a unit — otherwise the browser scrolls/zooms the page underneath.
// One finger is always left alone: scrolling stays native.
//
// Anchoring, same model as InfiniteCanvas's own onPinchMove: the baseline
// (distance + midpoint) is captured ONCE when two fingers land, and held
// fixed for the whole gesture — every subsequent frame computes an ABSOLUTE
// ratio against that one baseline, never against "last frame". The baseline
// only resets when the finger count actually changes (a finger lifts, or a
// third joins). Recomputing the anchor every frame — what this hook used to
// do — is what caused the visible jitter: floating-point drift and finger
// micro-jitter compound across frames instead of staying pinned to one
// fixed reference.
//
// Palm rejection, two layers:
//   1. While a real stylus is down anywhere (penActive, set by canvas.tsx),
//      touch input here is ignored outright.
//   2. A palm's contact patch is much wider than a fingertip's —
//      Touch.radiusX/radiusY (Chrome/WebKit) let us drop oversized contacts
//      before pairing them into a gesture, independent of pen state.

import { useEffect, useRef, type RefObject } from 'react'
import { penActive } from '@/lib/pointer/pen-active'

const PALM_RADIUS = 20

const touchRadius = (t: Touch) => {
  const rx = (t as unknown as { radiusX?: number }).radiusX ?? 0
  const ry = (t as unknown as { radiusY?: number }).radiusY ?? 0
  return Math.max(rx, ry)
}

const fingerTouches = (list: TouchList) => {
  const out: Touch[] = []
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    if (touchRadius(t) <= PALM_RADIUS) out.push(t)
  }
  return out
}

const midpoint = (t: Touch[]) => ({
  dist: Math.max(Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), 1),
  cx: (t[0].clientX + t[1].clientX) / 2,
  cy: (t[0].clientY + t[1].clientY) / 2,
})

export interface PinchHandlers {
  /** A fresh two-finger baseline just formed — capture whatever you need
   *  (current zoom, current scroll position) and anchor to THIS midpoint.
   *  Not called again until the finger count changes. */
  onStart: (clientX: number, clientY: number) => void
  /** ratio = current distance / distance at the last onStart (1 = unchanged).
   *  clientX/clientY is the CURRENT midpoint — only this moves frame to
   *  frame; the content-space anchor point should stay the one computed
   *  in onStart. */
  onMove: (ratio: number, clientX: number, clientY: number) => void
  onEnd?: () => void
}

export function usePinchZoom(ref: RefObject<HTMLElement | null>, handlers: PinchHandlers) {
  // Keep the latest handlers without re-binding native listeners every render.
  const h = useRef(handlers)
  h.current = handlers

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let baselineDist = 0

    const rebaseline = (fingers: Touch[]) => {
      const { dist, cx, cy } = midpoint(fingers)
      baselineDist = dist
      h.current.onStart(cx, cy)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (penActive.current) return
      const fingers = fingerTouches(e.touches)
      if (fingers.length !== 2) return
      e.preventDefault() // claim the gesture before the browser starts page zoom/scroll
      rebaseline(fingers)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (penActive.current) {
        baselineDist = 0 // pen came down mid-gesture — drop it, don't resume stale
        return
      }
      const fingers = fingerTouches(e.touches)
      if (fingers.length !== 2) return
      e.preventDefault() // the pinch is ours — don't let the browser pan/zoom
      if (baselineDist <= 0) {
        // Finger count reached 2 without going through onTouchStart (e.g. a
        // palm-filtered contact just stopped being filtered) — establish a
        // baseline now rather than compute against nothing.
        rebaseline(fingers)
        return
      }
      const { dist, cx, cy } = midpoint(fingers)
      h.current.onMove(dist / baselineDist, cx, cy)
    }

    const onTouchEnd = (e: TouchEvent) => {
      baselineDist = 0
      // Finger count CHANGED — re-anchor if a pinch-able pair remains
      // (matches "only update the anchor when a finger leaves the screen").
      const fingers = fingerTouches(e.touches)
      if (fingers.length === 2) rebaseline(fingers)
      else h.current.onEnd?.()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [ref])
}