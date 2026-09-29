'use client'

// On-screen keyboard awareness for the touch shell.
//
// Android Chrome honours `interactive-widget=resizes-content` (set on the
// notebook route), so the layout shrinks above the keyboard by itself. iOS
// Safari ignores it: the keyboard slides over the page and anything pinned to
// the bottom (tab bar, editing dock) ends up hidden underneath it or floating
// mid-screen. visualViewport is the one signal both platforms expose.
//
// Publishes, on <html>:
//   --keyboard-inset   px of layout covered by the keyboard (0 when closed)
//   data-keyboard      "open" while a keyboard is up
// so CSS can respond without every component subscribing. One listener pair,
// installed by the touch shell only.

import { useEffect } from 'react'

/** A viewport that shrank by more than this is a keyboard, not browser chrome
 *  (the URL bar collapsing is ~60-100px). */
const KEYBOARD_MIN_PX = 150

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        const open = covered > KEYBOARD_MIN_PX
        root.style.setProperty('--keyboard-inset', `${open ? Math.round(covered) : 0}px`)
        if (open) root.dataset.keyboard = 'open'
        else delete root.dataset.keyboard
      })
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--keyboard-inset')
      delete root.dataset.keyboard
    }
  }, [])
}
