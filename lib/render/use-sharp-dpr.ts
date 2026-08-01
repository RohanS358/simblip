'use client'

// R3F sizes its WebGL canvas from the CSS layout box × devicePixelRatio — it
// has no idea when an ANCESTOR applies `transform: scale()`, which is how
// doc-view/pdf-view implement page zoom (a pure visual magnification that
// deliberately doesn't touch layout, see doc-view.tsx). The canvas keeps
// rendering at the same fixed bitmap resolution and the browser just
// stretches that bitmap to fill the now-larger box — exactly like upscaling
// a raster image: blurry surface, jaggedy line edges, an out-of-focus orbit
// gizmo. DOM/SVG content doesn't have this problem because the browser
// re-rasterizes it at the new scale for free; WebGL has no such fallback.
//
// `device-pixel-content-box` reports an element's REAL on-screen device-pixel
// size with every ancestor transform baked in, so dividing it by the
// element's plain CSS width yields devicePixelRatio × the current page-zoom
// factor — feed that straight into <Canvas dpr={...}> and the render target
// always matches what's actually on screen, at any zoom level.
//
// A live zoom/pinch gesture (doc-view/pdf-view) updates its `scale()` on
// every wheel tick, so this observer fires many times a second while the
// gesture is running. Committing `dpr` on every one of those forces Three.js
// to reallocate its WebGL render target that often, which visibly stutters
// the scene mid-gesture. So the new value is debounced — same "GPU form
// during the gesture, settle to sharp once idle" convention canvas.tsx's
// paintViewport already uses for board pan/zoom — and only committed once
// the ancestor's scale actually stops changing.

import { useEffect, useRef, useState } from 'react'

const FALLBACK_CAP = 2 // matches R3F's own default dpr ceiling
const ZOOM_CAP = 6 // covers ~3x page zoom on a 2x retina display
const SETTLE_MS = 150

export function useSharpDpr<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, FALLBACK_CAP)
  )

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let settleTimer: number | null = null
    let ro: ResizeObserver
    try {
      ro = new ResizeObserver((entries) => {
        const entry = entries[0] as ResizeObserverEntry & {
          devicePixelContentBoxSize?: readonly { inlineSize: number }[]
        }
        const box = entry?.devicePixelContentBoxSize?.[0]
        if (!box || el.clientWidth <= 0) return
        const next = Math.min(ZOOM_CAP, Math.max(1, box.inlineSize / el.clientWidth))
        if (settleTimer !== null) window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(() => {
          settleTimer = null
          setDpr((prev) => (Math.abs(prev - next) > 0.02 ? next : prev))
        }, SETTLE_MS)
      })
      ro.observe(el, { box: 'device-pixel-content-box' })
    } catch {
      // Safari / older Firefox: no device-pixel-content-box support — stay
      // on the plain devicePixelRatio fallback above. Page zoom will blur
      // there same as it always has, nothing regresses.
      return
    }
    return () => {
      ro.disconnect()
      if (settleTimer !== null) window.clearTimeout(settleTimer)
    }
  }, [])

  return { ref, dpr }
}
