'use client'

// Two-finger pinch on a scrollable pane → zoom callbacks, for the paged
// surfaces (DocView, PdfView) whose zoom lives outside the canvas. Touch
// events (not pointer events) so a two-finger gesture can be preventDefault-ed
// as a unit — otherwise the browser scrolls/zooms the page underneath.
// One finger is always left alone: scrolling stays native.

import { useEffect, useRef, type RefObject } from 'react'

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

    const measure = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX
      const dy = t[0].clientY - t[1].clientY
      return {
        dist: Math.hypot(dx, dy),
        cx: (t[0].clientX + t[1].clientX) / 2,
        cy: (t[0].clientY + t[1].clientY) / 2,
      }
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      lastDist = measure(e.touches).dist
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      e.preventDefault() // the pinch is ours — don't let the browser pan/zoom
      const { dist, cx, cy } = measure(e.touches)
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
