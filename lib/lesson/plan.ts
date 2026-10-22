// The lesson PLAN: what a model is asked to write for a topic with no authored
// lesson. Deliberately tiny and flat — a 7–8B model fills this reliably; every
// number, scene and prediction answer is added later from the real simulator
// (director.ts), never taken from the model's imagination.

import { z } from 'zod'

export const LEVELS = ['new', 'basic', 'exam'] as const
export type Level = (typeof LEVELS)[number]

export const planSchema = z.object({
  title: z.string().min(2).max(100),
  /** Set INSTEAD of steps when the topic is unknown or ambiguous: the question to ask the student. A lesson on a
   *  theorem the model half-remembers is worse than no lesson. */
  unsure: z.string().min(3).max(240).optional(),
  steps: z
    .array(
      z.object({
        heading: z.string().min(2).max(80),
        /** 1–3 short sentences, spoken aloud. */
        say: z.array(z.string().min(3).max(260)).min(1).max(3),
        /** ONE sentence describing a simulation to draw, with concrete values. Omit when a picture would not help. */
        scene: z.string().min(8).max(240).optional(),
        /** The key relationship of this step as LaTeX. */
        equation: z.string().min(1).max(200).optional(),
        /** One sentence: what to CHANGE in the scene so the student can predict the effect ("double the resistance"). */
        experiment: z.string().min(3).max(160).optional(),
      })
    )
    .max(8),
}).refine((p) => p.unsure || p.steps.length >= 2, { message: 'steps: need at least 2 steps (or set "unsure")' })
export type Plan = z.infer<typeof planSchema>

/** JSON Schema for grammar-constrained decoding (Ollama `format`, llama.cpp). */
export const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    unsure: { type: 'string' },
    steps: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          say: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
          scene: { type: 'string' },
          equation: { type: 'string' },
          experiment: { type: 'string' },
        },
        required: ['heading', 'say'],
      },
    },
  },
  required: ['title', 'steps'],
}

const LEVEL_HINT: Record<Level, string> = {
  new: 'The student is new to this: plain words, everyday analogies, no maths before the simulation shows the idea.',
  basic: 'The student knows the basics: use the correct terms, show the key formula after the simulation.',
  exam: 'The student is revising for an exam: be precise, include the formula and what examiners ask about.',
}

export const planSystemPrompt = (level: Level) => `You plan a short animated lesson for an engineering or science student. Reply with JSON only.

${LEVEL_HINT[level]}

Rules:
- If you do not clearly recognise the topic, or it could mean several different things, do NOT guess and do NOT invent facts: set "unsure" to one short question asking what they mean (name the interpretations you can think of) and return an empty "steps" list.
- 4 to 6 steps. Each step teaches ONE idea. Order: the simplest picture first, then change one thing at a time, then a formula, then a real-world use.
- "say": 1-3 short sentences per step, at most 25 words each. They are read aloud.
- "scene": only when a simulation helps. One sentence with concrete values. The simulator can draw: electric circuits (battery, resistor, capacitor, inductor, diode, switch, op-amp, ammeter, voltmeter, bulb, logic gates), mechanics (masses, springs, pendulums, ramps, ropes, collisions, projectiles), waves and optics (lenses, mirrors, refraction, diffraction, interference), quantum wells, data-structure visualisations, graphs and tables. Do not describe things it cannot draw.
- "experiment": only for steps that have a scene. One sentence saying what to change so the effect can be predicted, e.g. "double the resistance" or "increase the angle to 60 degrees".
- "equation": LaTeX of the key relationship, only when one exists.
- The reply is exactly this shape ("say" is always a LIST of sentences; every step has a "heading"):
  {"title":"…","steps":[{"heading":"…","say":["…","…"],"scene":"…","equation":"…","experiment":"…"}]}
- Never state measured numbers (currents, speeds, results) in "say" — the simulator measures them and they are added automatically. Describe the idea, not the result.`

export const planUserPrompt = (topic: string) => `Topic: ${topic}`

/** Pull the first JSON object out of a model reply (fences, preamble, trailing talk). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  // Slips a model makes mid-object that are not worth a whole retry: a stray quote before a key
  // (`""say":` or `" "heading":` — it happens as it drops or re-starts a "heading"), and commas left
  // dangling before a closer.
  // Repaired BEFORE the object is scanned, because a stray quote flips the scanner's in-string state.
  const body = (fenced ? fenced[1] : text).replace(/([{,]\s*)"\s*"+\s*([A-Za-z_]\w*)"\s*:/g, '$1"$2":')
  const start = body.indexOf('{')
  if (start < 0) throw new Error('no JSON object in the reply')
  let depth = 0
  let inStr = false
  for (let i = start; i < body.length; i++) {
    const c = body[i]
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return JSON.parse(body.slice(start, i + 1).replace(/,(\s*[}\]])/g, '$1'))
  }
  throw new Error('JSON object is not closed')
}

const titleCase = (t: string) => t.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 100)
const asText = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const cut = (v: unknown, n: number): string | undefined => { const t = asText(v); return t ? (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t) : undefined }

/** Models drift from the shape they were asked for — a hosted model ignores the JSON schema, a small one forgets
 *  a field. Repair the harmless deviations (a sentence instead of a list of sentences, a missing heading or
 *  title, too many steps, "unsure" set alongside a full set of steps) so a good lesson is not thrown away over
 *  formatting; anything that is genuinely wrong still fails the schema. */
export function normalizePlan(raw: unknown, topic = ''): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = { ...(raw as Record<string, unknown>) }
  const steps = (Array.isArray(r.steps) ? r.steps : []).flatMap((st): unknown[] => {
    if (!st || typeof st !== 'object') return []
    const o = st as Record<string, unknown>
    const say = (Array.isArray(o.say) ? o.say : [o.say ?? o.text ?? o.narration]).map((x) => cut(x, 260)).filter((x): x is string => !!x).slice(0, 3)
    if (!say.length) return []
    const sentence = say[0].replace(/[.!?]+$/, '')
    const first = sentence.length <= 56 ? sentence : sentence.split(' ').slice(0, 7).join(' ') + '…'
    return [{
      heading: cut(o.heading ?? o.title ?? o.name, 80) ?? first,
      say,
      ...(cut(o.scene, 240) && cut(o.scene, 240)!.length >= 8 ? { scene: cut(o.scene, 240) } : {}),
      ...(cut(o.equation, 200) ? { equation: cut(o.equation, 200) } : {}),
      ...(cut(o.experiment, 160) && cut(o.experiment, 160)!.length >= 3 ? { experiment: cut(o.experiment, 160) } : {}),
    }]
  }).slice(0, 8)
  const unsure = cut(r.unsure, 240)
  return {
    title: cut(r.title, 100) ?? (topic ? titleCase(topic) : undefined),
    // A model that asks "do you mean X?" but also wrote a whole lesson has understood well enough: teach it.
    ...(unsure && steps.length < 2 ? { unsure } : {}),
    steps,
  }
}

/** Parse + validate; the error text is worded for the MODEL so one repair round can fix it. */
export function parsePlan(text: string, topic = ''): { ok: true; plan: Plan } | { ok: false; error: string } {
  let raw: unknown
  try { raw = extractJson(text) } catch (e) { return { ok: false, error: `${(e as Error).message}. Reply with one JSON object only.` } }
  const r = planSchema.safeParse(normalizePlan(raw, topic))
  if (r.success) return { ok: true, plan: r.data }
  return { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`).join('; ') }
}
