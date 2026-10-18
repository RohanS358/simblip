// The class list for SketchNet wave 1 (AI plan, Document 2, Appendix B).
//
// Every id is a SimScript kind — a class with no component to map to is a gap
// to report, not a class to invent. The test in synth.test.mjs checks each id
// against KNOWN_KINDS so this list cannot drift from the app.
//
// Version it: when a class is added or removed, old models are retrained, not
// patched (plan §5.6).

export const CLASS_LIST_VERSION = 1

/** Wave 1 — analog and digital circuits, ANSI/US symbols. */
export const WAVE1_CLASSES = [
  'battery', 'resistor', 'capacitor', 'inductor', 'switch', 'bulb',
  'led', 'diode', 'gnd', 'ac-source', 'voltmeter', 'ammeter',
  'and-gate', 'or-gate', 'xor-gate', 'nand-gate', 'nor-gate', 'not-gate',
  'bjt', 'mosfet', 'opamp',
] as const

/** Mechanics components a person can choose by hand for a drawn shape (the mechanics reader names these, not the network). */
export const MECH_PICK = ['block', 'mass', 'wheel', 'ground', 'beam', 'hinge'] as const

/** Not a symbol: doodles, partial symbols, stray marks. Teaches "I don't know". */
export const UNKNOWN_CLASS = 'unknown'

export type Wave1Class = (typeof WAVE1_CLASSES)[number]
export const ALL_LABELS: readonly string[] = [...WAVE1_CLASSES, UNKNOWN_CLASS]

/**
 * Which poses look identical. A resistor rotated 180° is the same drawing, so
 * asking the model to tell 0° from 180° would teach it noise. Pose labels are
 * folded to the canonical representative of each symmetry group.
 *   'none'  — all four poses are distinguishable
 *   'rot180'— 0≡180 and 90≡270
 */
export const POSE_SYMMETRY: Record<Wave1Class, 'none' | 'rot180'> = {
  battery: 'none', resistor: 'rot180', capacitor: 'rot180', inductor: 'rot180',
  switch: 'none', bulb: 'rot180', led: 'none', diode: 'none', gnd: 'none',
  'ac-source': 'rot180', voltmeter: 'rot180', ammeter: 'rot180',
  'and-gate': 'none', 'or-gate': 'none', 'xor-gate': 'none',
  'nand-gate': 'none', 'nor-gate': 'none', 'not-gate': 'none',
  bjt: 'none', mosfet: 'none', opamp: 'none',
}

export type Pose = 0 | 90 | 180 | 270

export function canonicalPose(cls: string, pose: Pose): Pose {
  if (POSE_SYMMETRY[cls as Wave1Class] === 'rot180') return (pose % 180) as Pose
  return pose
}
