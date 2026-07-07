// The AI contract, v2. The AI is an assistant, not a dependency: it returns
// the SAME primitives + behaviors a user places by hand — never templates,
// never direct canvas access. The editor validates and imports (docs/architecture.md).

import { z } from 'zod'
import { BEHAVIOR_TYPES } from '@/lib/behaviors/registry'
import type { BehaviorType } from '@/lib/scene/types'

export const aiBehaviorSchema = z.object({
  // Derived from BEHAVIOR_SPECS (lib/behaviors/registry.ts) — every behavior
  // that actually exists, never hand-copied, so this can't silently drift
  // out of sync as new domains (waves, quantum…) get added.
  type: z.enum(BEHAVIOR_TYPES as [BehaviorType, ...BehaviorType[]]),
  /** parameter name → expression (enters the page's formula scope) */
  params: z.record(z.string(), z.string()).default({}),
})

export const aiObjectSchema = z.object({
  geometry: z.enum(['circle', 'rect', 'polygon', 'line', 'note', 'text', 'formula', 'graph', 'symbol']),
  /** symbol: palette component id (resistor, battery, and-gate, voltmeter…) */
  symbol: z.string().optional(),
  /** symbol: numeric params, e.g. { R: "100", V: "9" } */
  params: z.record(z.string(), z.string()).optional(),
  name: z.string().optional(),
  /** Offsets relative to the drop point (top-left of bbox). */
  dx: z.number().default(0),
  dy: z.number().default(0),
  w: z.number().optional(),
  h: z.number().optional(),
  rotation: z.number().optional(),
  /** line/polygon: points relative to (dx, dy) */
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  /** visual hint: 'spring' | 'rope' | 'damper' | 'ground' | 'hinge' | 'motor' */
  render: z.string().optional(),
  behaviors: z.array(aiBehaviorSchema).default([]),
  /** notes/text: content; formula: LaTeX */
  text: z.string().optional(),
  /** graphs: bind to the Nth object in this payload + channels */
  graphSource: z.number().optional(),
  graphChannels: z.array(z.string()).optional(),
})

export const simulationPayloadSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  variables: z.array(z.object({ name: z.string(), expr: z.string() })).default([]),
  objects: z.array(aiObjectSchema).default([]),
})

export const aiResponseSchema = z.object({
  message: z.string(),
  simulation: simulationPayloadSchema.optional(),
})

export type AiObject = z.infer<typeof aiObjectSchema>
export type SimulationPayload = z.infer<typeof simulationPayloadSchema>
export type AiResponse = z.infer<typeof aiResponseSchema>
