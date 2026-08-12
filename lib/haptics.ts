// Haptic feedback for touch interactions.
//
// Progressive enhancement, deliberately: Android/Chrome supports
// navigator.vibrate, iOS Safari does not and never has. There's no polyfill
// worth having — the fallback is simply "no buzz", which is what the platform
// already does today. So this is free upside on Android and a no-op on iOS,
// rather than something to feature-detect around at each call site.
//
// Keep the durations SHORT. A tab switch is not an event that deserves a
// noticeable buzz; it deserves a tick you feel more than hear. Anything past
// ~20ms reads as a notification rather than as feedback for your own tap.

/** Feedback weights, by what the interaction means — not by milliseconds, so
 *  call sites don't encode timing decisions. */
const PATTERNS = {
  /** A tap landed: tab switch, page open, tool select. */
  tick: 8,
  /** A state committed: sheet dismissed, item deleted, drag released. */
  bump: 14,
  /** Something was rejected or failed. Two short pulses read as "no". */
  reject: [8, 40, 8],
} as const

export type HapticKind = keyof typeof PATTERNS

/**
 * Fire a haptic tick. Silently does nothing where unsupported (iOS, desktop,
 * SSR) or where the user has asked for reduced motion — a vestibular or
 * sensory-sensitivity setting should quiet physical feedback too, not just
 * on-screen movement.
 */
export function haptic(kind: HapticKind = 'tick'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }
  try {
    navigator.vibrate(PATTERNS[kind] as number | number[])
  } catch {
    // Some browsers throw when vibrate() is called without a user gesture.
    // A missing buzz is never worth breaking the interaction that caused it.
  }
}
