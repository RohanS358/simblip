// The teacher's skeleton, as pure maths: which hand goes where, how an arm bends to get
// there, what a mood does to the face, and how open the mouth is for a given letter.
// No DOM — the painter in components/workspace/teacher.tsx applies these every frame.
// Coordinates are the character's own drawing space (viewBox), y pointing down.

export type Mood = 'neutral' | 'happy' | 'curious' | 'concerned' | 'thinking' | 'excited'
export type Pose = 'read' | 'open' | 'point' | 'wave' | 'think'
export interface Pt { x: number; y: number }

export const SHOULDER_L: Pt = { x: 122, y: 236 }
export const SHOULDER_R: Pt = { x: 282, y: 236 }
export const UPPER = 86
export const FORE = 92
export const BOOK_HAND: Pt = { x: 208, y: 302 }

/** Where the right hand goes for each pose. `point` is computed from the thing pointed at. */
export const RIGHT_HAND: Record<Exclude<Pose, 'point'>, Pt> = {
  read: { x: 300, y: 240 },
  open: { x: 392, y: 276 },
  wave: { x: 352, y: 118 },
  think: { x: 236, y: 178 },
}

export interface Face {
  /** −1 worried … +1 raised */ brow: number
  /** −1 frown … +1 grin */ smile: number
  /** head tilt, degrees */ tilt: number
  /** eye openness multiplier */ eye: number
}
export const MOODS: Record<Mood, Face> = {
  neutral: { brow: 0, smile: 0.35, tilt: 0, eye: 1 },
  happy: { brow: 0.3, smile: 0.9, tilt: 2, eye: 1 },
  curious: { brow: 0.9, smile: 0.4, tilt: -6, eye: 1.1 },
  concerned: { brow: -0.8, smile: -0.1, tilt: -4, eye: 1.05 },
  thinking: { brow: 0.5, smile: 0.05, tilt: 5, eye: 0.85 },
  excited: { brow: 0.9, smile: 1, tilt: 0, eye: 1.15 },
}

/** Two-bone arm: the elbow that lets a shoulder reach `target`, bowed downwards like a relaxed arm.
 *  A target beyond reach straightens the arm and the hand stops at its length. */
export function arm(shoulder: Pt, target: Pt, l1 = UPPER, l2 = FORE): { elbow: Pt; hand: Pt } {
  const dx = target.x - shoulder.x, dy = target.y - shoulder.y
  const reach = l1 + l2 - 0.5
  const raw = Math.hypot(dx, dy) || 1e-6
  const d = Math.min(reach, Math.max(Math.abs(l1 - l2) + 1, raw))
  const base = Math.atan2(dy, dx)
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
  const pick = (sign: number): Pt => ({ x: shoulder.x + l1 * Math.cos(base + sign * a), y: shoulder.y + l1 * Math.sin(base + sign * a) })
  const e1 = pick(1), e2 = pick(-1)
  const elbow = e1.y >= e2.y ? e1 : e2
  const k = d / raw
  return { elbow, hand: { x: shoulder.x + dx * k, y: shoulder.y + dy * k } }
}

/** A straight-armed point towards `at`: the hand lands on the line from shoulder to target. */
export function pointTarget(shoulder: Pt, at: Pt): Pt {
  const dx = at.x - shoulder.x, dy = at.y - shoulder.y, d = Math.hypot(dx, dy) || 1
  const reach = UPPER + FORE - 2
  return { x: shoulder.x + (dx / d) * reach, y: shoulder.y + (dy / d) * reach }
}

/** How open the mouth is while saying a letter: vowels wide, lip sounds shut. */
export function visemeOf(ch: string | undefined): number {
  if (!ch) return 0.2
  const c = ch.toLowerCase()
  if ('ao'.includes(c)) return 0.95
  if ('ei'.includes(c)) return 0.6
  if (c === 'u' || c === 'w') return 0.45
  if ('mbp'.includes(c)) return 0
  if (/[a-z]/.test(c)) return 0.3
  if (c === ' ') return 0.1
  return 0.05 // punctuation: a pause
}
