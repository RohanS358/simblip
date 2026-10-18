// Scene IR — the contract every sketch-recognition stage emits (AI plan 2,
// Appendix A). Stages only ADD or REFINE fields; compile.ts turns an IR into
// SimScript with no model in the loop, so a wrong IR can never produce a
// broken scene — only a clearly-reported compile error.
import { z } from 'zod'

const Rot = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])

const Node = z.object({
  id: z.string(),
  /** A SimScript create() kind (validated against ANCHOR_INDEX / the mechanics
   *  and optics tables at compile time, not here — the class list evolves). */
  cls: z.string(),
  conf: z.number().min(0).max(1),
  alt: z.array(z.object({ cls: z.string(), conf: z.number() })).max(3).optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  rot: Rot,
  flip: z.boolean().optional(),
  values: z.record(z.string(), z.string()).optional(),
  source: z.enum(['ink', 'photo']),
})

const Pin = z.object({ node: z.string(), pin: z.string() })

const Edge = z.object({
  a: Pin,
  b: Pin,
  kind: z.enum(['wire', 'rope', 'rod', 'spring', 'damper']),
  conf: z.number(),
})

const Label = z.object({
  text: z.string(),
  bbox: z.array(z.number()).length(4),
  attachedTo: z.string().optional(),
})

const Doubt = z.object({
  ref: z.string(),
  why: z.enum(['low-confidence', 'ambiguous-junction', 'dangling-wire', 'unreadable-value']),
})

export const SketchIR = z.object({
  domain: z.enum(['circuit', 'digital', 'mechanics', 'optics', 'diagram']),
  nodes: z.array(Node),
  edges: z.array(Edge),
  labels: z.array(Label),
  doubts: z.array(Doubt),
})

export type SketchIRType = z.infer<typeof SketchIR>
export type IRNode = z.infer<typeof Node>
export type IREdge = z.infer<typeof Edge>
export type IRDoubt = z.infer<typeof Doubt>

/** Ghost-overlay dot colour for a confidence (plan 3.4). */
export function confTier(conf: number): 'green' | 'amber' | 'red' {
  return conf >= 0.9 ? 'green' : conf >= 0.6 ? 'amber' : 'red'
}
