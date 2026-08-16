'use client'

/**
 * The simulated cursor's motor control.
 *
 * The whole point of the walkthrough is that a viewer sees the pointer travel
 * to a real control, press it, and only THEN see the result. So every effect
 * routes through here: `moveTo` resolves a live on-screen element, animates the
 * pointer to it over real time, and the caller runs its effect after arrival.
 *
 * Cursor position lives in a module-level store (not React state) so the
 * animation loop can write it at 60fps without re-rendering the whole overlay.
 */

import { useDocStore } from '../store/document'

export type Pt = { x: number; y: number }

type CursorState = {
  x: number
  y: number
  pressed: boolean
  /** Ripple ping counter — bumping it triggers one click ripple. */
  clicks: number
  /** Live ink trail while the pen is down, in screen coords. */
  trail: Pt[]
  visible: boolean
}

const listeners = new Set<() => void>()
let state: CursorState = { x: 0, y: 0, pressed: false, clicks: 0, trail: [], visible: false }

const emit = () => listeners.forEach((l) => l())

export const cursorStore = {
  get: () => state,
  set: (patch: Partial<CursorState>) => {
    state = { ...state, ...patch }
    emit()
  },
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

/** Speed multiplier, mirrored from the walkthrough store by the engine. */
let speed = 1
export const setCursorSpeed = (s: number) => {
  speed = s > 0 ? s : 1
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / speed))

/** Ease-in-out — a hand accelerates away and decelerates onto a target. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * Animate the pointer from where it is to `to` over `ms`.
 *
 * The path bows slightly perpendicular to the direction of travel: real hands
 * never move in a straight line, and the arc is what reads as "a person did
 * this" rather than "a tween ran".
 */
export async function glideTo(to: Pt, ms = 900): Promise<void> {
  const from = { x: state.x, y: state.y }
  if (!state.visible) {
    // First appearance: no travel from (0,0), just materialise on target.
    cursorStore.set({ x: to.x, y: to.y, visible: true })
    await sleep(120)
    return
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  if (dist < 2) return
  // Long trips take longer, but sub-linearly — capped so nothing drags.
  const dur = Math.min(1600, Math.max(320, ms * Math.min(1, dist / 700 + 0.35))) / speed
  const bow = Math.min(60, dist * 0.12)
  const nx = -(to.y - from.y) / (dist || 1)
  const ny = (to.x - from.x) / (dist || 1)

  const start = performance.now()
  return new Promise((resolve) => {
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const e = ease(t)
      // Sine bow peaks mid-flight and returns to zero at both ends.
      const arc = Math.sin(t * Math.PI) * bow
      cursorStore.set({
        x: from.x + (to.x - from.x) * e + nx * arc,
        y: from.y + (to.y - from.y) * e + ny * arc,
      })
      if (t < 1) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
}

/** Centre of a live element, or null when it isn't on screen. */
export function centerOf(selector: string): Pt | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** Press-and-release animation. Returns after the button visually settles. */
export async function pressCursor() {
  cursorStore.set({ pressed: true, clicks: state.clicks + 1 })
  await sleep(140)
  cursorStore.set({ pressed: false })
  await sleep(120)
}

/**
 * Move to a real control, press it, and dispatch a genuine click.
 *
 * Dispatching real pointer + click events (rather than calling a store action)
 * is what keeps the demo honest: the app responds exactly as it would to a
 * human, so anything the walkthrough shows is something the viewer can repeat.
 */
export async function clickElement(selector: string, ms = 900): Promise<boolean> {
  const pt = centerOf(selector)
  if (!pt) return false
  await glideTo(pt, ms)
  await sleep(180)
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return false
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: pt.x, clientY: pt.y }))
  await pressCursor()
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: pt.x, clientY: pt.y }))
  el.click()
  await sleep(260)
  return true
}

// ── Canvas coordinate mapping ────────────────────────────────────────────────

const canvasEl = () => document.querySelector('[aria-label="Infinite canvas"]') as HTMLElement | null

/** A point inside the canvas viewport, given as a 0–1 fraction of its box. */
export function canvasPoint(fx: number, fy: number): Pt | null {
  const el = canvasEl()
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width * fx, y: r.top + r.height * fy }
}

/**
 * Screen point → page coordinates, mirroring canvas.tsx's `toCanvas`.
 *
 * This is the bridge that makes objects land under the cursor tip instead of
 * at some hardcoded position: we place at exactly the point we just flew to.
 */
export function screenToCanvas(pageId: string, p: Pt): Pt {
  const el = canvasEl()
  if (!el) return p
  const r = el.getBoundingClientRect()
  const s = el.offsetWidth ? r.width / el.offsetWidth : 1
  const local = { x: (p.x - r.left) / s, y: (p.y - r.top) / s }
  const vp = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
  return { x: (local.x - vp.x) / vp.zoom, y: (local.y - vp.y) / vp.zoom }
}

/** Page coordinates → screen point. Inverse of `screenToCanvas`. */
export function canvasToScreen(pageId: string, p: Pt): Pt | null {
  const el = canvasEl()
  if (!el) return null
  const r = el.getBoundingClientRect()
  const s = el.offsetWidth ? r.width / el.offsetWidth : 1
  const vp = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
  return { x: r.left + (p.x * vp.zoom + vp.x) * s, y: r.top + (p.y * vp.zoom + vp.y) * s }
}

/** Drag the pointer along a path with the button held (pen strokes, panning). */
export async function dragAlong(path: Pt[], ms = 1400): Promise<Pt[]> {
  if (!path.length) return []
  await glideTo(path[0], 700)
  cursorStore.set({ pressed: true, trail: [path[0]] })
  await sleep(120)
  const per = ms / Math.max(1, path.length - 1)
  for (let i = 1; i < path.length; i++) {
    await glideTo(path[i], per)
    cursorStore.set({ trail: [...cursorStore.get().trail, path[i]] })
  }
  await sleep(160)
  cursorStore.set({ pressed: false })
  return path
}

export const clearTrail = () => cursorStore.set({ trail: [] })

export const hideCursor = () =>
  cursorStore.set({ visible: false, pressed: false, trail: [] })
