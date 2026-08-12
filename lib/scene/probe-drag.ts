'use client'

// A probe drag starts in a component's header (components/objects/probe-buttons)
// but is DRAWN by the canvas overlay (components/workspace/probe-layer), which
// is a sibling in the React tree, not an ancestor. Rather than thread state
// through the whole canvas, the button announces the gesture here and the
// layer picks it up — the same outside-React handoff pattern the physics bus
// uses, and for the same reason: the two ends never need to re-render together.

import type { Vec2 } from './types'

export interface ProbeDragRequest {
  pageId: string
  objectId: string
  /** Which probe of that object — its param name ('series', 'inputs', …). */
  param: string
  /** World-space anchor the arrow is drawn from. */
  from: Vec2
}

type Listener = (req: ProbeDragRequest) => void

const listeners = new Set<Listener>()

/** Start a probe drag. The mounted probe layer takes it from here. */
export function beginProbeDrag(req: ProbeDragRequest) {
  listeners.forEach((fn) => fn(req))
}

export function onProbeDrag(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
