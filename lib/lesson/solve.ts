// Teaching from material the student brings — a photographed question, a pasted problem, a chapter of notes — instead of
// a topic name. The planner is asked for a worked solution (or a lecture) in the same shape every other lesson uses, so
// the director draws it, the player performs it and the teacher can be interrupted exactly as in any lesson.
//
// A solution has one thing a lecture does not: NUMBERS the model must not be trusted with. A language model predicts
// the digits of "0.025 / 0.004394 =" instead of computing them, so every worked line is recomputed here and a wrong one
// is corrected out loud (lib/ai/arithmetic.ts). Pure — the model is injected.

import { checkArithmetic } from '@/lib/ai/arithmetic'
import { PLAN_JSON_SCHEMA, parsePlan, type Level, type Plan, type PlanCaps } from './plan'
import type { Llm } from './director'

export { PLAN_JSON_SCHEMA }

export { wantsBrief } from './brief'

/** Looks like an exercise to be solved (as opposed to notes to be studied). */
export function isQuestion(text: string): boolean {
  const t = text.slice(0, 1500)
  const asks = /\b(?:find|calculate|compute|determine|evaluate|solve|derive|prove|show that|how (?:much|many|long|far|fast|high)|what (?:is|are|will|would|must)|if .{3,80}\bthen\b)\b/i.test(t) || /\?/.test(t) || /^\s*(?:q\.?\s*\d+|question|problem|numerical|ex(?:ample|ercise))\b/i.test(t)
  return asks && /\d/.test(t)
}

export const WHOLE: PlanCaps = { steps: 12, say: 5 }
export const SHORT: PlanCaps = { steps: 6, say: 2 }
export const capsFor = (brief: boolean): PlanCaps => (brief ? SHORT : WHOLE)

const LEVEL: Record<Level, string> = {
  new: 'The student is new to this: define every term the first time you use it and use everyday analogies.',
  basic: 'The student knows the basics: name the law or formula and say why it applies here.',
  exam: 'The student is revising for an exam: be precise, name the formula and say what marks are given for.',
}

const SCENES = `"scene": ONE sentence that draws the situation with the question's REAL numbers, for any step where a picture helps. The simulator can draw electric circuits (battery, resistor, capacitor, inductor, diode, op-amp, logic gates), mechanics (masses, springs, pendulums, inclines, projectiles, collisions), optics, waves, and CASH-FLOW DIAGRAMS for engineering economics (e.g. "cash flow diagram: pay 10000 at year 0, receive 3000 each year for years 1 to 5, interest 8%"). Omit it when no picture would help.`

export const solveSystem = (level: Level, brief: boolean) => `You are a teacher solving a problem on a board for a student, step by step. Reply with JSON only: {"title":"…","steps":[{"heading":"…","say":["…"],"scene":"…","equation":"…"}]}

${LEVEL[level]}

How to teach this solution:
- Step 1 "What we are given": restate the data and what is asked, in words. Add a "scene" that draws the situation with the real numbers.
- Then ONE idea per step, in the order a teacher would work it: choose the method and say WHY it applies, write the formula, substitute the numbers, calculate. ${brief ? 'Keep it short: 4 to 6 steps, 1 or 2 sentences each.' : 'Explain every step in detail — do not skip algebra, do not say "clearly". AT LEAST 6 and up to 10 steps, 2 to 5 sentences each, at most 28 words per sentence (they are read aloud).'}
- "equation": LaTeX of that step's working with the actual numbers substituted AND the result, written as a chain ending in the number, e.g. "A = P(1+i)^{n} = 1000(1+0.05)^{3} = 1157.63". Always end with "= <number>" so it can be checked. Omit it for steps with no calculation.
- ${SCENES}
- Second to last step: CHECK the answer (substitute back, or a sanity check on size and units).
- Last step: state the final answer in a full sentence with its unit.
- Every step that calculates something MUST have an "equation" with the numbers in it. A solution with no equations is wrong.
- Shape of a good step: {"heading":"Current through the resistor","say":["The battery pushes its full voltage across the resistor.","Ohm's law then tells us how much current flows."],"equation":"I = \\frac{V}{R} = \\frac{12}{4} = 3"}
- If the text is not a problem you can solve (it is cut off, or unreadable), set "unsure" to one question asking the student what they meant, and leave steps empty.`

export const materialSystem = (level: Level, brief: boolean) => `You are a teacher giving a lesson from the student's own material (notes, a chapter, a document). Reply with JSON only: {"title":"…","steps":[{"heading":"…","say":["…"],"scene":"…","equation":"…","experiment":"…"}]}

${LEVEL[level]}

- Teach what the material says — do NOT add facts that are not in it or directly implied by it. Follow its order.
- ${brief ? 'Cover the main ideas only: 4 to 6 steps, 1 or 2 sentences each.' : 'Cover EVERYTHING in it, in detail: one step per idea (up to 10), 3 to 5 sentences each, at most 28 words per sentence (they are read aloud). Define each term, say why it matters, give an everyday example, and walk through any worked example number by number.'}
- ${SCENES}
- "equation": the key formula of that step in LaTeX, only when the material has one.
- "experiment": for a step with a scene, one sentence saying what to change so the student can predict the effect.
- If the material is unreadable or too short to teach, set "unsure" to one question and leave steps empty.`

export const askSystem = (level: Level, brief: boolean) => `You are a teacher. The student is looking at a page and asks you a question about it (or about its subject). Answer it as a short lesson at the board. Reply with JSON only: {"title":"…","steps":[{"heading":"…","say":["…"],"scene":"…","equation":"…","experiment":"…"}]}

${LEVEL[level]}

- Answer THE QUESTION. The page contents are given so you can refer to what the student sees ("the second formula on your page") and use its numbers; teach only what the question needs from them, do not recite the whole page.
- Start with a direct one or two sentence answer, then build the understanding: why it is so, an everyday example, and a worked example with the page's numbers if it has any.
- ${brief ? '3 or 4 steps, 1 or 2 sentences each.' : '4 to 7 steps, 2 to 4 sentences each, at most 28 words per sentence (they are read aloud).'}
- ${SCENES}
- "equation": the formula the step uses in LaTeX, only when there is one. "experiment": for a step with a scene, one sentence saying what to change so the student can predict the effect.
- If the question cannot be answered from the page or general knowledge, set "unsure" to one question asking what they meant, and leave steps empty.`

/** Ask for a plan, repairing once or twice with the validator's own message (the same loop planTopic uses). */
export async function planFromText(llm: Llm, system: string, user: string, topic: string, caps: PlanCaps, signal?: AbortSignal): Promise<Plan> {
  let note = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = parsePlan(await llm.complete(system, user + note, { jsonSchema: PLAN_JSON_SCHEMA, signal }), topic, caps)
    if (r.ok) return r.plan
    note = `\n\nYour previous reply was invalid: ${r.error}`
  }
  throw new Error('Could not get a usable lesson plan from that.')
}

// ── numbers ────────────────────────────────────────────────────────────────
/** A number the arithmetic proved wrong, replaced wherever later steps went on to use it (a wrong annuity factor poisons
 *  the net present value computed from it). Numbers are matched by value, so "12,476.92" and "12476.92" are the same. */
const carry = (text: string, from: number, to: number) =>
  text.replace(/-?\d[\d,]*(?:\.\d+)?/g, (tok) => {
    const v = Number(tok.replace(/,/g, ''))
    if (!Number.isFinite(v) || Math.abs(v - from) > Math.abs(from) * 1e-9) return tok
    const dp = tok.includes('.') ? tok.length - tok.indexOf('.') - 1 : 0
    const fixed = (tok.startsWith('-') ? -to : to).toFixed(dp)
    return tok.includes(',') ? Number(fixed).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : fixed
  })

/** Recompute every completed substitution in the worked lines. A wrong one is replaced by the true value and the teacher says so;
 *  every later step that used the wrong value is carried forward and rechecked. */
export function verifySolution(plan: Plan): { plan: Plan; fixed: number } {
  let fixed = 0
  const changes: { from: number; to: number }[] = []
  const steps = plan.steps.map((st) => {
    let step = st
    for (const c of changes) step = { ...step, say: step.say.map((t) => carry(t, c.from, c.to)), ...(step.equation ? { equation: carry(step.equation, c.from, c.to) } : {}) }
    if (!step.equation) return step
    const r = checkArithmetic(step.equation)
    if (!r.fixes.length) return step
    fixed += r.fixes.length
    for (const f of r.fixes) changes.push({ from: f.claimed, to: f.actual })
    const said = r.fixes.map((f) => `Checking the arithmetic: that comes to ${Number(f.actual.toPrecision(6))}, so I have corrected the line.`)
    return { ...step, equation: r.markdown, say: [...step.say, ...said].slice(0, 5) }
  })
  return { plan: { ...plan, steps }, fixed }
}
