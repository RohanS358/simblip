// Scene IR — the contract between every sketch-recognition stage and the
// compiler (docs: SIMBLIP AI Plan, Document 2, §3.2 and Appendix A).
//
// Stages may only add or refine these fields; nothing upstream of the compiler
// invents canvas objects. A better recogniser tomorrow changes nothing
// downstream, and a human can write ground truth by hand.

import { z } from 'zod'

const Rot = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])

export const IRNode = z.object({
  id: z.string().min(1),
  /** A SimScript kind (validated at compile time, not here). */
  cls: z.string().min(1),
  conf: z.number().min(0).max(1),
  /** Top-3 alternatives for the correction menu. */
  alt: z.array(z.object({ cls: z.string(), conf: z.number() })).max(3).optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Pose; polarity lives here. */
  rot: Rot,
  flip: z.boolean().optional(),
  /** Raw text per parameter, e.g. { R: '10k' } — the compiler parses units. */
  values: z.record(z.string(), z.string()).optional(),
  source: z.enum(['ink', 'photo']),
})

/** Pin names are SimScript anchors (.positive, .a, .anode, .in1 …). */
export const IRPin = z.object({ node: z.string().min(1), pin: z.string().min(1) })

export const IREdge = z.object({
  a: IRPin,
  b: IRPin,
  kind: z.enum(['wire', 'rope', 'rod', 'spring', 'damper']),
  conf: z.number().min(0).max(1),
})

export const IRLabel = z.object({
  text: z.string(),
  bbox: z.array(z.number()).length(4),
  attachedTo: z.string().optional(),
})

export const IRDoubt = z.object({
  ref: z.string(),
  why: z.enum(['low-confidence', 'ambiguous-junction', 'dangling-wire', 'unreadable-value']),
})

export const SketchIR = z.object({
  domain: z.enum(['circuit', 'digital', 'mechanics', 'optics', 'diagram']),
  nodes: z.array(IRNode),
  edges: z.array(IREdge),
  labels: z.array(IRLabel),
  doubts: z.array(IRDoubt),
})

export type SketchIRNode = z.infer<typeof IRNode>
export type SketchIREdge = z.infer<typeof IREdge>
export type SketchIRDoubt = z.infer<typeof IRDoubt>
export type SketchIRType = z.infer<typeof SketchIR>
