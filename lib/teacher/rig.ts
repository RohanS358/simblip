// The teacher's skeleton, as pure maths: where the working hand goes for each gesture, how an
// arm bends to get there, what a mood does to the face, and how open the mouth is for a letter.
// No DOM — the painter in components/workspace/teacher.tsx applies these every frame.
// Coordinates are the character's own drawing space (the traced art is 420 x 741), y pointing down.

export type Mood = 'neutral' | 'happy' | 'curious' | 'concerned' | 'thinking' | 'excited' | 'surprised' | 'proud' | 'sympathetic' | 'laughing'
export type Pose = 'read' | 'open' | 'point' | 'wave' | 'think' | 'palm' | 'thumb' | 'shrug' | 'proud' | 'celebrate'
export type HandShape = 'fist' | 'open' | 'point' | 'thumb' | 'palm'
export interface Pt { x: number; y: number }

export const SHOULDER_R: Pt = { x: 282, y: 234 }
export const UPPER = 84
export const FORE = 96

/** What each pose asks of the body. `hand` is null for the resting pose (the traced arm holding the
 *  book) and for `point`, which aims at whatever she is pointing at. */
export interface PoseSpec { hand: Pt | null; shape: HandShape; lean: number; shrug: number; tilt: number }
export const POSES: Record<Pose, PoseSpec> = {
  read: { hand: null, shape: 'fist', lean: 0, shrug: 0, tilt: 0 },
  open: { hand: { x: 398, y: 268 }, shape: 'open', lean: 0.4, shrug: 0, tilt: 0 },
  point: { hand: null, shape: 'point', lean: 0.8, shrug: 0, tilt: 0 },
  wave: { hand: { x: 372, y: 104 }, shape: 'open', lean: 0.2, shrug: 0, tilt: 3 },
  think: { hand: { x: 240, y: 180 }, shape: 'fist', lean: -0.3, shrug: 0, tilt: 4 },
  palm: { hand: { x: 380, y: 214 }, shape: 'palm', lean: 0.3, shrug: 0, tilt: 0 },
  thumb: { hand: { x: 352, y: 196 }, shape: 'thumb', lean: 0.2, shrug: 0, tilt: 0 },
  shrug: { hand: { x: 392, y: 288 }, shape: 'open', lean: 0, shrug: 1, tilt: -5 },
  proud: { hand: { x: 252, y: 244 }, shape: 'palm', lean: -0.2, shrug: 0, tilt: 2 },
  celebrate: { hand: { x: 366, y: 84 }, shape: 'open', lean: 0.2, shrug: 0, tilt: 0 },
}

export interface Face {
  /** −1 worried … +1 raised, per brow (the nearer brow is the left one on the drawing) */
  browL: number; browR: number
  /** inner ends of the brows: −1 pulled down (stern) … +1 pulled up (worried, sympathetic) */
  inner: number
  /** −1 frown … +1 grin */ smile: number
  /** head tilt, degrees */ tilt: number
  /** eye openness multiplier */ eye: number
  /** 0 round eyes … 1 happy crescents */ squint: number
  /** blush strength */ blush: number
  /** the mouth never closes below this (surprise, laughter) */ mouthMin: number
}
export const MOODS: Record<Mood, Face> = {
  neutral: { browL: 0, browR: 0, inner: 0, smile: 0.35, tilt: 0, eye: 1, squint: 0, blush: 0, mouthMin: 0 },
  happy: { browL: 0.3, browR: 0.3, inner: 0, smile: 0.9, tilt: 2, eye: 1, squint: 0, blush: 0.25, mouthMin: 0 },
  curious: { browL: 1, browR: 0.25, inner: 0, smile: 0.4, tilt: -6, eye: 1.1, squint: 0, blush: 0, mouthMin: 0 },
  concerned: { browL: -0.2, browR: -0.2, inner: 1, smile: -0.2, tilt: -4, eye: 1.05, squint: 0, blush: 0, mouthMin: 0 },
  thinking: { browL: 0.6, browR: -0.1, inner: 0, smile: 0.05, tilt: 5, eye: 0.85, squint: 0, blush: 0, mouthMin: 0 },
  excited: { browL: 0.9, browR: 0.9, inner: 0, smile: 1, tilt: 0, eye: 1.15, squint: 0, blush: 0.35, mouthMin: 0.25 },
  surprised: { browL: 1, browR: 1, inner: 0.2, smile: 0.1, tilt: 0, eye: 1.3, squint: 0, blush: 0, mouthMin: 0.7 },
  proud: { browL: 0.25, browR: 0.25, inner: 0, smile: 0.85, tilt: 3, eye: 1, squint: 0.85, blush: 0.3, mouthMin: 0 },
  sympathetic: { browL: 0.1, browR: 0.1, inner: 0.9, smile: 0.2, tilt: -7, eye: 1.05, squint: 0, blush: 0.1, mouthMin: 0 },
  laughing: { browL: 0.5, browR: 0.5, inner: 0, smile: 1, tilt: 2, eye: 1, squint: 1, blush: 0.4, mouthMin: 0.55 },
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

/** Which gesture suits a line she is about to say: a question offers a palm, an exclamation opens
 *  the hand, and the rest alternate so she is never repeating one movement. */
export function gestureFor(text: string, n: number): Pose {
  if (text.includes('?')) return 'palm'
  if (text.includes('!')) return 'open'
  return n % 3 === 2 ? 'palm' : 'open'
}
