'use client'

// Live pointer overlay for board-live desktop<->board mirroring. Position is
// in the same 0..1 normalized canvas space the sender captured it in, scaled
// to this viewport's own dimensions — so it stays correct if desktop and
// board have different screen sizes.
//
// `anchor="fixed"` covers the whole viewport (app/board, which is
// full-screen); `anchor="absolute"` positions relative to a `relative`
// ancestor instead (the smaller embedded panel in app/present).

import type { PeerCursor } from '@/lib/data/board-live-cursor'

export function PeerCursorOverlay({
  cursor,
  anchor = 'fixed',
}: {
  cursor: PeerCursor | null
  anchor?: 'fixed' | 'absolute'
}) {
  if (!cursor) return null
  const label = cursor.origin === 'board' ? 'Board' : cursor.origin === 'desktop' ? 'Presenter' : cursor.origin

  return (
    <div
      className={`pointer-events-none ${anchor} z-[9999]`}
      style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-sm">
        <path
          d="M2 1.5 L2 15.5 L6 11.8 L8.5 16.5 L10.5 15.5 L8 10.8 L13 10.8 Z"
          fill="var(--accent-blue)"
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <span className="ml-3 -mt-1 inline-block rounded-md bg-[var(--accent-blue)] px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
        {label}
      </span>
    </div>
  )
}
