// Tracks whether a real stylus is currently down anywhere in the app, so
// touch-driven gestures elsewhere (pinch-zoom, etc.) can ignore a resting
// palm's touch events while writing instead of misreading them as input.
//
// Wire this from canvas.tsx's pointer handlers:
//
//   import { penActive } from '@/lib/pointer/pen-active'
//
//   // in the pointerdown handler:
//   if (e.pointerType === 'pen') penActive.current = true
//
//   // in the pointerup / pointercancel handler:
//   if (e.pointerType === 'pen') penActive.current = false
//
// A plain mutable object (not React state) on purpose — this is read inside
// a native touch listener's hot path (use-pinch-zoom.ts), not during render,
// so it doesn't need to trigger a re-render or go through context.
export const penActive = { current: false }
