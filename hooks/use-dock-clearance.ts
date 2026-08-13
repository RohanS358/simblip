'use client'

// The tool dock is user-dockable to any edge and its length changes with
// context (touch tools, attach, AI, calculator). Instead of every floating
// control hard-coding guesses about where the dock might be, the dock
// publishes its measured rect here and neighbours call useDockClearance,
// which slides them out of the way — only when they'd actually collide,
// and always perpendicular to the dock's edge.

import { create } from 'zustand'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export type DockSide = 'top' | 'bottom' | 'left' | 'right'

export interface DockRect {
  side: DockSide
  left: number
  top: number
  right: number
  bottom: number
}

interface DockRectState {
  rect: DockRect | null
  set: (rect: DockRect | null) => void
}

/** Written by the Toolbar (the only dock); read by everything that floats. */
export const useDockRect = create<DockRectState>((set) => ({
  rect: null,
  set: (rect) => set({ rect }),
}))

interface ViewChromeState {
  bottom: number
  set: (bottom: number) => void
}

/**
 * Height of the chrome the ACTIVE page view draws along the bottom of its own
 * area — today only the presentation's slide rail + control bar.
 *
 * The dock overlay spans the whole content box (canvas-controls.tsx), so
 * without this it lands on top of that chrome and, being pointer-events-auto,
 * eats the taps meant for it. Same "publish your rect, neighbours move" idea
 * as useDockRect above, in the other direction.
 */
export const useViewChrome = create<ViewChromeState>((set) => ({
  bottom: 0,
  set: (bottom) => set({ bottom }),
}))

/**
 * Attach the returned ref to the element wrapping your view's bottom chrome.
 * Measured rather than declared, because the height is a CSS concern that
 * changes with breakpoint and collapse state.
 */
export function useBottomChrome<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const publish = () => useViewChrome.getState().set(el.offsetHeight)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      useViewChrome.getState().set(0)
    }
  }, [])
  return ref
}

const GAP = 8

/**
 * Returns a {x, y} translate that keeps the element clear of the dock.
 * Apply it via the CSS `translate` property so it composes with any
 * `transform` the element already uses for centring or animation.
 * Pass in `deps` whatever state changes the element's size or position.
 */
export function useDockClearance(
  ref: RefObject<HTMLElement | null>,
  deps: readonly unknown[] = []
) {
  const rect = useDockRect((s) => s.rect)
  const [tick, setTick] = useState(0)
  const [shift, setShift] = useState({ x: 0, y: 0 })
  const applied = useRef({ x: 0, y: 0 })

  // Re-measure when the element or its pane resizes (split drags, keyboard,
  // label swaps). The dock's own changes arrive through the rect store.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('resize', bump)
    const ro = new ResizeObserver(bump)
    ro.observe(el)
    if (el.offsetParent) ro.observe(el.offsetParent)
    return () => {
      window.removeEventListener('resize', bump)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useLayoutEffect(() => {
    const el = ref.current
    const set = (x: number, y: number) => {
      applied.current = { x, y }
      setShift((s) => (s.x === x && s.y === y ? s : { x, y }))
    }
    if (!el || !rect) return set(0, 0)
    const r = el.getBoundingClientRect()
    // The current shift is baked into the measured rect — subtract it so the
    // decision is made from the element's natural spot, not where we put it.
    const base = {
      left: r.left - applied.current.x,
      top: r.top - applied.current.y,
      right: r.right - applied.current.x,
      bottom: r.bottom - applied.current.y,
    }
    const hits =
      base.left < rect.right + GAP &&
      base.right > rect.left - GAP &&
      base.top < rect.bottom + GAP &&
      base.bottom > rect.top - GAP
    if (!hits) return set(0, 0)
    if (rect.side === 'bottom') set(0, rect.top - GAP - base.bottom)
    else if (rect.side === 'top') set(0, rect.bottom + GAP - base.top)
    else if (rect.side === 'left') set(rect.right + GAP - base.left, 0)
    else set(rect.left - GAP - base.right, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, tick, ...deps])

  return shift
}
