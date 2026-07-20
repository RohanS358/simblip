'use client'

// Two-finger pinch on a scrollable pane → zoom callbacks, for the paged
// surfaces (DocView, PdfView) whose zoom lives outside the canvas. Touch
// events (not pointer events) so a two-finger gesture can be preventDefault-ed
// as a unit — otherwise the browser scrolls/zooms the page underneath.
// One finger is always left alone: scrolling stays native.
//
// Palm rejection, two layers:
//   1. While a real stylus is down anywhere (penActive, set by canvas.tsx),
//      touch input here is ignored outright — a resting palm firing touch
//      events during pen use must never read as a pinch.
//   2. Independent of that: a palm's contact patch is much wider than a
//      fingertip's. Touch.radiusX/radiusY (Chrome/WebKit) let us drop
//      oversized contacts before pairing them into a gesture, catching palm
//      touches even on the rare path where no pen is currently down (e.g.
//      pinching right after lifting the pen, before penActive clears).

import { useEffect, useRef, type RefObject } from 'react'
import { penActive } from '@/lib/pointer/pen-active'

/** Contact patch radius above which a touch is treated as a palm, not a
 *  fingertip. Real fingertip contacts are typically ~5-15px; tune per device
 *  if this proves too aggressive/lax in testing. */
const PALM_RADIUS = 20

const touchRadius = (t: Touch) => {
  // radiusX/radiusY are non-standard-but-widely-supported; absent on some
  // browsers (Safari), in which case we simply can't filter by size there —
  // layer 1 (penActive) still covers the common pen+palm case regardless.
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

export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  /** Called per move with the gesture midpoint (client coords) and the scale
   *  factor since the LAST call — feed it straight into an anchored zoomAt. */
  onPinch: (clientX: number, clientY: number, factor: number) => void
) {
  // The callback closes over per-render state; keep the latest one without
  // re-binding the listeners every render.
  const cb = useRef(onPinch)
  cb.current = onPinch
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let lastDist = 0

    const measure = (t: Touch[]) => {
      const dx = t[0].clientX - t[1].clientX
      const dy = t[0].clientY - t[1].clientY
      return {
        dist: Math.hypot(dx, dy),
        cx: (t[0].clientX + t[1].clientX) / 2,
        cy: (t[0].clientY + t[1].clientY) / 2,
      }
    }

    const onStart = (e: TouchEvent) => {
      if (penActive.current) return
      const fingers = fingerTouches(e.touches)
      if (fingers.length !== 2) return
      lastDist = measure(fingers).dist
    }
    const onMove = (e: TouchEvent) => {
      if (penActive.current) {
        lastDist = 0 // pen came down mid-gesture — drop the pinch, don't resume it stale
        return
      }
      const fingers = fingerTouches(e.touches)
      if (fingers.length !== 2) return
      e.preventDefault() // the pinch is ours — don't let the browser pan/zoom
      const { dist, cx, cy } = measure(fingers)
      if (lastDist > 0 && dist > 0) cb.current(cx, cy, dist / lastDist)
      lastDist = dist
    }
    const onEnd = () => {
      lastDist = 0
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [ref])
}
