'use client'

// The app's motion language.
//
// Every panel, dock and popover used to hard-code `stiffness: 380, damping: 32`
// — critically damped, so things arrive and stop dead. That reads as "correct"
// but not alive. Real UI motion (Material 3, iOS, Figma) is UNDER-damped: it
// overshoots slightly and settles, which is what makes it feel physical.
//
// One source of truth, so the whole app moves the same way — and so the user
// can dial it down (or off) from Appearance.

import { useSyncExternalStore } from 'react'
import type { Transition } from 'framer-motion'
import { usePrefs, type MotionStyle } from '@/lib/store/preferences'

// OS-level "reduce motion" always wins over the in-app setting — a vestibular
// user shouldn't have to find our Appearance panel to make the UI hold still.
const REDUCED = '(prefers-reduced-motion: reduce)'
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const osReduced = () => window.matchMedia(REDUCED).matches

/** OS-level reduce-motion. False on the server. */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, osReduced, () => false)
}

/**
 * Springs are described by mass/stiffness/damping rather than a duration —
 * they're interruptible, so grabbing a panel mid-animation redirects it
 * instead of fighting it.
 *
 * bouncy: damping < critical → overshoots and settles. The lively default.
 * smooth: critically damped → fast and calm, no overshoot.
 * none:   instant, for reduced-motion or low-power devices.
 */
const SPRINGS: Record<MotionStyle, Transition> = {
  bouncy: { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 },
  smooth: { type: 'spring', stiffness: 380, damping: 34, mass: 1 },
  none: { duration: 0 },
}

/** A softer, slower spring for big surfaces (sheets, modals, the focus view). */
const SPRINGS_SOFT: Record<MotionStyle, Transition> = {
  bouncy: { type: 'spring', stiffness: 300, damping: 24, mass: 1 },
  smooth: { type: 'spring', stiffness: 300, damping: 32, mass: 1 },
  none: { duration: 0 },
}

/** Snappy — small things that should feel instant but not robotic (buttons). */
const SPRINGS_SNAP: Record<MotionStyle, Transition> = {
  bouncy: { type: 'spring', stiffness: 600, damping: 22, mass: 0.6 },
  smooth: { type: 'spring', stiffness: 600, damping: 30, mass: 0.6 },
  none: { duration: 0 },
}

export type MotionKind = 'default' | 'soft' | 'snap'

function pick(kind: MotionKind, style: MotionStyle): Transition {
  if (kind === 'soft') return SPRINGS_SOFT[style]
  if (kind === 'snap') return SPRINGS_SNAP[style]
  return SPRINGS[style]
}

/** Reactive: use inside components so changing the setting takes effect live. */
export function useSpring(kind: MotionKind = 'default'): Transition {
  const style = usePrefs((s) => s.appearance.motion)
  const reduced = useOsReducedMotion()
  return pick(kind, reduced ? 'none' : style)
}

/** Non-reactive read, for places outside React. */
export const spring = (kind: MotionKind = 'default'): Transition =>
  pick(
    kind,
    typeof window !== 'undefined' && window.matchMedia(REDUCED).matches
      ? 'none'
      : usePrefs.getState().appearance.motion
  )

/** True when motion is switched off — skip mount animations entirely. */
export const useMotionOff = (): boolean => {
  const off = usePrefs((s) => s.appearance.motion) === 'none'
  return useOsReducedMotion() || off
}

/** The pop-in a panel/popover uses: scale + fade, so it grows from nothing. */
export const POP = {
  initial: { opacity: 0, scale: 0.94 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
}
