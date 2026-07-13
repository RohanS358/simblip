import * as React from 'react'

// Which UI to run: the touch shell (phone + tablet) or the desktop shell.
//
// Viewport width is the wrong signal. A tablet in landscape is 1024px wide —
// wider than plenty of desktop windows — so a width rule either sends iPads to
// the desktop UI or sends a half-screen desktop window to the phone UI. Both
// are wrong, and the second is what was happening.
//
// What actually distinguishes them is the INPUT. Phones and tablets have a
// coarse primary pointer and no hover; a mouse is fine and hovers, at any
// window size. So we ask about the pointer, not the pixels:
//
//   iPhone / Android phone    coarse + no hover  → touch UI
//   iPad / Android tablet     coarse + no hover  → touch UI (even at 1024px+)
//   desktop, small window     fine + hover       → desktop UI
//   2-in-1 with a mouse       fine + hover       → desktop UI
//   2-in-1, keyboard detached coarse + no hover  → touch UI
//
// `pointer`/`hover` describe the PRIMARY input, which is exactly the question
// worth asking: what is this person most likely holding right now?

const TOUCH_QUERY = '(pointer: coarse) and (hover: none)'

/** iPadOS 13+ reports itself as desktop Safari on macOS, so the media query
 *  can't be trusted alone there — but a real Mac has no touch points. */
function isIPadOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)
}

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(TOUCH_QUERY).matches || isIPadOS()
}

/**
 * True on phones AND tablets — i.e. run the touch shell. Never true for a
 * desktop window, however narrow it gets.
 * (Name kept for the existing call sites; the meaning is "touch device".)
 */
export function useIsMobile() {
  const [isTouch, setIsTouch] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(TOUCH_QUERY)
    const onChange = () => setIsTouch(detectTouch())
    mql.addEventListener('change', onChange) // fires when a mouse is attached
    setIsTouch(detectTouch())
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isTouch
}

export const useIsTouchDevice = useIsMobile

/** Narrow VIEWPORT — a layout question (do the side panels still fit?), which
 *  is separate from what kind of device this is. A desktop window dragged
 *  narrow should collapse its panels without becoming the phone app. */
export function useIsNarrow(maxWidth = 767) {
  const [narrow, setNarrow] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const onChange = () => setNarrow(mql.matches)
    mql.addEventListener('change', onChange)
    setNarrow(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [maxWidth])

  return narrow
}
