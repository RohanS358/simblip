// The edit lane: generate a JSON op plan against the page you are on.
//
// Mirrors the SimScript lane's generate -> verify -> repair loop
// (lib/ai/generate.ts), for the same reason: a plan that fails verification
// carries an exact, machine-produced error, and a model handed its own error
// usually fixes it in one more round. What it must never do is apply.

import { z } from 'zod'
import type { PageDoc } from '@/lib/scene/types'
import type { SimScriptGenerator } from './generate'
import { verifyPlan, ADDABLE_GEOMETRY, type EditPlan } from './edit-ops'
import { COMPONENTS } from '@/lib/scene/factory'
import { BEHAVIOR_TYPES } from '@/lib/behaviors/registry'

const MAX_REPAIRS = 2
/** A plan is short. Anything longer is a model rambling rather than editing. */
const EDIT_TOKENS = 700

/** Component ids the model may add, grouped so the list stays readable at a
 *  glance. Generated from the real registry — a hand-copied list is how the
 *  old aiBehaviorSchema drifted 14 types out of date. */
const componentList = (): string =>
  Object.entries(
    COMPONENTS.reduce<Record<string, string[]>>((acc, c) => {
      ;(acc[c.domain] ??= []).push(c.id)
      return acc
    }, {})
  )
    .map(([domain, ids]) => `- ${domain}: ${ids.join(' ')}`)
    .join('\n')

export const EDIT_SYSTEM_PROMPT = `You edit a SIMBLIP notebook page. The user is looking at the page described below and wants it CHANGED — not rebuilt.

OUTPUT
- Reply with ONE JSON object and nothing else. No markdown fences, no prose.
- Shape: {"ops":[…],"summary":"one short sentence"}
- Use the FEWEST ops that satisfy the request. Editing three things means three ops, not a rebuilt page.

OPS
- {"op":"update","id":"<id>","position":{"x":0,"y":0},"size":{"w":0,"h":0},"rotation":0,"name":"…"} — every field optional except id.
- {"op":"setParam","id":"<id>","name":"<param>","value":"<string>"} — change content or a number. Use the parameter names shown in the page listing.
- {"op":"add","component":"<id>","position":{"x":0,"y":0},"name":"…","params":{"text":"…"}} — add something new. Set its content in "params" HERE; you cannot setParam on an object this plan is still creating.
- {"op":"remove","ids":["<id>"]}
- {"op":"addBehavior","id":"<id>","type":"<behavior>"}
- {"op":"setVariable","name":"<name>","expr":"<expression>"}

RULES
- Object ids come from the page listing. NEVER invent one. If the request names something not on the page, add it instead.
- An object marked <SELECTED> is what the user means by "this", "it", "here", "this textbox", "this note" or "the selected one".
- WRITING INTO SOMETHING THAT EXISTS IS setParam, NOT add. "Write the definition of X in this textbox" with a note selected is ONE op: {"op":"setParam","id":"<the selected id>","name":"text","value":"<the definition>"}. Adding a second note beside the one the user selected is wrong.
- You write the CONTENT, not a placeholder. Put the actual definition, answer or summary in "value" — never "…" or "your text here".
- Text lives in the "text" parameter for note/text objects and "latex" for a formula. The page listing shows which parameters each object has.
- Positions are page pixels, x right, y down. Place a new object clear of the ones already listed.
- Do not restate the page. Only emit ops that change something.

WIDGETS & SHAPES (use these for notes, labels, graphs, tables and controls)
${ADDABLE_GEOMETRY.join(' ')}

COMPONENTS (physics and circuit parts)
${componentList()}

BEHAVIORS
${BEHAVIOR_TYPES.join(' ')}`

export interface EditResult {
  plan: EditPlan
  attempts: number
  backend: string
}

export class EditFailedError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
    readonly raw: string
  ) {
    super(message)
    this.name = 'EditFailedError'
  }
}

/** Pull the JSON object out of a reply. Models wrap it in fences or add a
 *  sentence despite being told not to; the object itself is still usable, and
 *  failing the whole turn over a stray "Here you go:" would be needless. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : raw).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object in the reply')
  return JSON.parse(body.slice(start, end + 1))
}

export async function generateEditPlan(
  request: string,
  doc: PageDoc | undefined,
  opts: { generator: SimScriptGenerator; systemPrompt?: string }
): Promise<EditResult> {
  const system = opts.systemPrompt ?? EDIT_SYSTEM_PROMPT
  let prompt = request
  let lastErrors: string[] = []
  let lastRaw = ''

  for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt++) {
    const raw = await opts.generator.generate(system, prompt, undefined, undefined, EDIT_TOKENS)
    lastRaw = raw

    let parsed: unknown
    try {
      parsed = extractJson(raw)
    } catch (e) {
      lastErrors = [e instanceof Error ? e.message : 'unparseable reply']
      prompt = `${request}\n\nYour last reply was not valid JSON (${lastErrors[0]}). Reply with ONLY the JSON object.`
      continue
    }

    const check = verifyPlan(parsed, doc)
    if (check.ok && check.plan) return { plan: check.plan, attempts: attempt, backend: opts.generator.name }

    lastErrors = check.errors
    // Hand the model its own errors — the same repair contract the SimScript
    // lane uses, and the reason most second attempts succeed.
    prompt = `${request}\n\nYour last plan was rejected:\n${check.errors.map((e) => `- ${e}`).join('\n')}\n\nFix these and reply with ONLY the corrected JSON.`
  }

  throw new EditFailedError(
    "I couldn't build a valid edit for that.",
    lastErrors,
    lastRaw
  )
}

/** Kept beside the schema it validates so the two cannot drift. */
export const editPlanResponseSchema = z.object({
  ops: z.array(z.unknown()),
  summary: z.string(),
})
