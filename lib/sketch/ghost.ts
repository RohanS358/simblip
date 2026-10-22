// The ghost preview's state and the small rules around it: what colour a
// confidence gets, how big a placed symbol is, what a correction records.
// Pure — the canvas holds the state, components/workspace/ghost-preview.tsx
// draws it.

import type { Box } from './neural-pick'
import type { Pose } from './classes'
import type { Device } from './corrections'

/** A recognised symbol shown over the user's ink, awaiting confirm / correct. */
export interface Ghost {
  pageId: string
  cls: string
  /** Probability of `cls`, or null once the user has picked a class themselves. */
  p: number | null
  pose: Pose
  /** Page-coordinate box of every stroke the symbol covers. */
  box: Box
  /** The ink objects this would replace (the held stroke + any it absorbed). */
  ids: string[]
  /** Other plausible symbols, most likely first. */
  alts: Array<{ cls: string; p: number }>
  /** What the model first said — kept so a correction records the disagreement. */
  predicted: string
  predictedP: number
  rotated: boolean
  device: Device
  /**
   * The reading is only a guess (see tierOf): it is shown so the person can pick the right part from the
   * choices, but it is not placed on a bare Enter / "Make it live" until they have chosen.
   */
  unsure?: boolean
}

export type Confidence = 'high' | 'medium' | 'low' | 'chosen'

/** Green ≥ 0.9, amber 0.6–0.9, red below (plan §3.4); 'chosen' once the user decides. */
/** The reading still needs the person's say before it can be placed. */
export const needsChoice = (g: Pick<Ghost, 'p' | 'unsure'>): boolean => !!g.unsure && g.p !== null

export function confidenceOf(p: number | null): Confidence {
  if (p === null) return 'chosen'
  return p >= 0.9 ? 'high' : p >= 0.6 ? 'medium' : 'low'
}

/** The symbol's footprint over the strokes it replaces (the rule the old convert used). */
export function ghostSize(box: Box, isSymbol: boolean): { w: number; h: number } {
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  if (isSymbol) {
    const w = Math.min(200, Math.max(72, bw))
    return { w, h: w / 2 }
  }
  return { w: Math.max(24, bw), h: Math.max(24, bh) }
}

/** Next 90° turn. */
export const nextPose = (p: Pose): Pose => (((p + 90) % 360) as Pose)

export function pointerDevice(pointerType: string): Device {
  return pointerType === 'touch' ? 'finger' : pointerType === 'pen' ? 'pen' : 'mouse'
}
