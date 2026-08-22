'use client'

// A plain wheel scrolls a horizontal-only strip.
//
// The app is full of one-line scrolling strips — the AI panel's quick actions,
// the palette's package chips, the tab bar, the uploads filter. A mouse wheel
// (and a trackpad's vertical flick) produces deltaY, which those strips ignore
// because they have nothing to scroll vertically. The event then bubbles to
// whatever DOES scroll vertically behind them, so the page moves while the
// thing under the pointer sits still. Only a shift+wheel or a deliberate
// sideways trackpad gesture worked, and neither is discoverable.
//
// This maps deltaY onto scrollLeft for elements that scroll horizontally and
// NOT vertically. An element that scrolls both ways is left alone — there the
// vertical wheel already means something.
//
// One global listener rather than a hook per strip: any strip added later gets
// the behaviour without knowing this exists.

import { useEffect } from 'react'

/** Lines and pages come back in deltaMode 1/2; normalise to rough pixels. */
function pixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 16 // lines
  if (e.deltaMode === 2) return e.deltaY * 100 // pages
  return e.deltaY
}

function scrollsHorizontally(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false
  const x = getComputedStyle(el).overflowX
  return x === 'auto' || x === 'scroll'
}

function scrollsVertically(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false
  const y = getComputedStyle(el).overflowY
  return y === 'auto' || y === 'scroll'
}

export function WheelToHorizontal() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // ctrl/⌘+wheel is zoom (canvas, PDF stack, browser) — never ours.
      if (e.ctrlKey || e.metaKey) return
      // Something closer to the target already handled it: the canvas pans,
      // graph-3d dollies, pdf-view zooms. Bubble phase + this check means we
      // only ever act on a wheel nobody else wanted.
      if (e.defaultPrevented) return
      // A real sideways gesture needs no translating.
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return

      let node = e.target as Element | null
      while (node && node !== document.body) {
        // The first ancestor that scrolls vertically wins the event, exactly
        // as it would natively — stop before reaching past it.
        if (scrollsVertically(node)) return
        if (scrollsHorizontally(node)) {
          const dx = pixels(e)
          const max = node.scrollWidth - node.clientWidth
          const next = node.scrollLeft + dx
          // At either end, hand the gesture back so the page can scroll
          // instead of the wheel dying against a wall.
          if ((dx < 0 && node.scrollLeft <= 0) || (dx > 0 && node.scrollLeft >= max)) return
          node.scrollLeft = Math.max(0, Math.min(max, next))
          e.preventDefault()
          return
        }
        node = node.parentElement
      }
    }
    // passive:false so preventDefault actually suppresses the page scroll.
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])
  return null
}
