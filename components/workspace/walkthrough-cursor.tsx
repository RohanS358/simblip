'use client'

import { useSyncExternalStore } from 'react'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { cursorStore } from '@/lib/walkthrough/walkthrough-cursor-driver'

/**
 * The simulated pointer.
 *
 * Position comes from the driver's own store, written every animation frame,
 * so the cursor genuinely travels across the screen rather than jumping to each
 * target. Rendering straight from that store (instead of React state per step)
 * keeps the motion smooth and the overlay out of the app's render path.
 */
export function WalkthroughCursor() {
  const active = useWalkthroughStore((s) => s.active)
  const c = useSyncExternalStore(
    cursorStore.subscribe,
    cursorStore.get,
    cursorStore.get,
  )

  if (!active || !c.visible) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {/* Ink trail drawn while the pen is held down */}
      {c.trail.length > 1 && (
        <svg className="absolute inset-0 h-full w-full">
          <polyline
            points={c.trail.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--accent-blue)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        </svg>
      )}

      {/* Press ripple — keyed on the click counter so each press replays it */}
      <span
        key={c.clicks}
        className="absolute h-9 w-9 rounded-full border-2 border-[var(--accent-blue)] bg-[var(--accent-blue)]/25 walkthrough-ripple"
        style={{ left: c.x - 18, top: c.y - 18 }}
      />

      {/* The pointer itself — dips slightly on press, like a real click */}
      <div
        className="absolute top-0 left-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
        style={{
          transform: `translate3d(${c.x - 4}px, ${c.y - 3}px, 0) scale(${c.pressed ? 0.82 : 1})`,
          transition: 'transform 90ms ease-out',
        }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
          <path
            d="M5.5 3.5L18.5 11.5L12.5 13.5L15.5 19.5L13 20.5L10 14.5L5.5 18V3.5Z"
            fill="var(--accent-blue)"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}
