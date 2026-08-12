'use client'

// Easter egg: hold "Report a bug" for five seconds and the bug gets out.
//
// Every icon on the page turns into a bug, the cursor turns into a bug, and
// the only way back is to find the one RED bug crawling around and squash it.
//
// Done entirely with one class on <html> plus a stylesheet, not by walking the
// DOM and swapping components: an SVG element accepts a CSS `background`, so
// hiding an icon's own paths and painting a bug behind them converts every
// lucide icon in the app — including ones that mount while the egg is running
// — with no React involvement and nothing to unwind afterwards. Removing the
// class puts the entire app back exactly as it was.
//
// Deliberately non-blocking: the overlay is pointer-events-none apart from the
// red bug itself, and Escape always ends it. An easter egg that can trap
// someone mid-edit is a bug report, not a joke.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const HOLD_MS = 5000

/** lucide's `bug` glyph, paths only. */
const BUG_PATHS =
  '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>'

/** A bug as a data: URI — no network, no icon component. `halo` draws a fat
 *  white outline underneath so the shape survives on any background (the
 *  cursor and the target bug both land on unknown colors). */
const bugSvg = (color: string, halo = false) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      (halo ? `<g stroke="#fff" stroke-width="5" opacity="0.85">${BUG_PATHS}</g>` : '') +
      `<g stroke="${color}" stroke-width="2">${BUG_PATHS}</g>` +
      `</svg>`
  )}`

/** Random point inside the viewport, inset so the bug never lands half
 *  off-screen where it couldn't be clicked. */
const roam = () => ({
  x: 24 + Math.random() * Math.max(1, window.innerWidth - 80),
  y: 24 + Math.random() * Math.max(1, window.innerHeight - 80),
})

export function BugSwarm({ onEnd }: { onEnd: () => void }) {
  const [pos, setPos] = useState(roam)
  const [squashed, setSquashed] = useState(false)

  // The infestation itself: one class, one stylesheet, applied for as long as
  // this component is mounted.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('bug-loose')
    return () => root.classList.remove('bug-loose')
  }, [])

  // Escape hatch. Always available — see the header note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEnd()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEnd])

  // It crawls. A stationary red dot is found in a second; a moving one you
  // have to actually chase, which is the whole game.
  useEffect(() => {
    if (squashed) return
    const t = setInterval(() => setPos(roam()), 2600)
    return () => clearInterval(t)
  }, [squashed])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <style>{`
        /* Every icon in the app is an <svg>. Blank its own paths and paint a
           bug behind them — works for icons that mount later too. Excludes the
           red bug below (and anything else that opts out) so the target stays
           visible. */
        html.bug-loose svg:not([data-no-bug]) > * { opacity: 0 !important; }
        html.bug-loose svg:not([data-no-bug]) {
          /* MASK, not background-image: a data: URI is its own document, so
             \`currentColor\` inside it would resolve to black there and vanish in
             every dark theme. Masking a solid fill of currentColor instead
             makes each bug inherit the exact color of the icon it replaced. */
          -webkit-mask: url("${bugSvg('#000')}") center / contain no-repeat;
          mask: url("${bugSvg('#000')}") center / contain no-repeat;
          background-color: currentColor;
          animation: bug-jitter 0.9s steps(2, end) infinite;
        }
        /* Images and avatars aren't <svg>, so they get their own treatment. */
        html.bug-loose img { filter: hue-rotate(80deg) saturate(1.6); }
        html.bug-loose, html.bug-loose * {
          cursor: url("${bugSvg('#111', true)}") 12 12, auto !important;
        }
        @keyframes bug-jitter {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          50%      { transform: translate(0.5px, -0.5px) rotate(-4deg); }
        }
        @keyframes bug-scuttle {
          0%, 100% { transform: translate(-50%, -50%) rotate(-12deg) scale(1); }
          50%      { transform: translate(-50%, -50%) rotate(12deg) scale(1.08); }
        }
        /* Motion-sensitive users get the hunt without the twitching. */
        @media (prefers-reduced-motion: reduce) {
          html.bug-loose svg:not([data-no-bug]) { animation: none; }
        }
      `}</style>

      <div className="pointer-events-none fixed inset-0 z-[9999]">
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <span className="rounded-full bg-black/75 px-3 py-1 text-[0.75rem] font-medium text-white shadow-lg">
            {squashed ? 'Got it. Sorry about that.' : 'A bug got loose. Find the red one — or press Esc.'}
          </span>
        </div>

        {!squashed && (
          <button
            type="button"
            aria-label="Squash the red bug"
            onClick={() => {
              setSquashed(true)
              // Beat of "you got it" before the app snaps back, so the click
              // reads as having done something.
              setTimeout(onEnd, 700)
            }}
            className="pointer-events-auto absolute h-6 w-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            style={{
              left: pos.x,
              top: pos.y,
              transition: 'left 2.4s ease-in-out, top 2.4s ease-in-out',
            }}
          >
            <span
              aria-hidden
              className="block h-full w-full"
              style={{
                background: `url("${bugSvg('#ef4444', true)}") center / contain no-repeat`,
                animation: 'bug-scuttle 0.5s ease-in-out infinite',
              }}
            />
          </button>
        )}
      </div>
    </>,
    document.body
  )
}

/**
 * Props for the element that arms the egg — spread onto the "Report a bug"
 * item. A five-second hold is long enough that nobody triggers it by accident
 * and short enough that someone who suspects something holds long enough to
 * find out.
 *
 * `fired` is reported back so the host can swallow the click/select that
 * follows the hold: otherwise letting go both starts the egg AND opens the
 * bug-report dialog behind it.
 */
export function useBugHold(onFire: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A ref, not state: the `onSelect` that needs to read it fires in the same
  // tick as pointerup, before any re-render could deliver a state update.
  const fired = useRef(false)

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])

  return {
    fired,
    handlers: {
      onPointerDown: () => {
        fired.current = false
        cancel()
        timer.current = setTimeout(() => {
          fired.current = true
          onFire()
        }, HOLD_MS)
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
    },
  }
}
