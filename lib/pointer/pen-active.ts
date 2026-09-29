'use client'

// Is a stylus in use right now? Touch gestures elsewhere (pinch-zoom on docs
// and PDFs, one-finger ink on a canvas) read this to ignore a resting palm
// while the user writes.
//
// ROOT-CAUSE FIX: this used to be a bare `{ current }` flag that canvas.tsx set
// to true on pen-down and NOTHING ever set back to false. After the first pen
// stroke of a session, every touch gesture that consulted it (usePinchZoom)
// was ignored for good — pinch-zoom on documents and PDFs silently died the
// moment a stylus had been used once.
//
// It is now tracked in one place from real pen events: in contact, or lifted
// less than PEN_GRACE_MS ago (a palm tends to land just after the nib lifts
// between strokes). One passive, capture-phase listener per event type on
// window — installed once, never calls preventDefault, never stops
// propagation, so it can't interfere with anything else's handling.

export const PEN_GRACE_MS = 600

let down = false
let liftedAt = 0
let installed = false

function install(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const opts = { capture: true, passive: true } as const
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'pen') return
      down = true
      // First stylus on this device: from now on fingers navigate and the
      // pen writes on documents/slides/PDFs (GesturePrefs.fingerInk 'auto').
      void import('@/lib/store/preferences').then(({ usePrefs }) => {
        if (!usePrefs.getState().gestures.penSeen) usePrefs.getState().setGestures({ penSeen: true })
      })
    },
    opts
  )
  const lift = (e: PointerEvent) => {
    if (e.pointerType !== 'pen') return
    down = false
    liftedAt = Date.now()
  }
  window.addEventListener('pointerup', lift, opts)
  window.addEventListener('pointercancel', lift, opts)
  // A tab switch mid-stroke never delivers pointerup.
  window.addEventListener('blur', () => (down = false))
}

/** True while a stylus is touching the screen or lifted within the grace
 *  window. `graceMs` lets a caller use a longer window (e.g. palm rejection
 *  while the user is actively writing). */
export function isPenActive(graceMs = PEN_GRACE_MS): boolean {
  install()
  return down || Date.now() - liftedAt < graceMs
}

/** Called by a pen handler that sees pen-down before the window listener
 *  would (e.g. inside a capture-phase React handler); keeps state exact. */
export function notePenDown(): void {
  install()
  down = true
}

if (typeof window !== 'undefined') install()
