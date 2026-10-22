// A Storyboard is a lesson as DATA: an ordered list of beats a player performs on
// the canvas — narration, a live simulation appearing, a formula, a prediction
// the student must commit to before the simulation reveals the answer.
//
// Data, not code, on purpose: authored offline or converted from a course
// lesson, linted headlessly, and the runtime stays dumb (see Course Mode).
// Pure module — importable from Node tests and the browser.

import { z } from 'zod'
import { lintSimScript } from '@/lib/ai/simscript-lint'

export const beatSchema = z.discriminatedUnion('t', [
  /** A chapter card: names what is coming. */
  z.object({ t: z.literal('title'), text: z.string().min(1).max(120), sub: z.string().max(160).optional() }),
  /** Narration + caption. One or two sentences — it is spoken aloud. */
  z.object({ t: z.literal('say'), text: z.string().min(1).max(420) }),
  /** A live simulation appears on the canvas (SimScript, linted). `clear` removes the previous scene first. */
  z.object({ t: z.literal('scene'), script: z.string().min(1), caption: z.string().max(200).optional(), clear: z.boolean().default(true) }),
  /** A formula appears, with what it says in words. */
  z.object({ t: z.literal('equation'), latex: z.string().min(1).max(300), text: z.string().max(420).optional() }),
  /** The cursor glides to a named object on the canvas and rings it, while a line is said. */
  z.object({ t: z.literal('point'), object: z.string().min(1).max(60), text: z.string().min(1).max(300) }),
  /** A parameter sweeps from `from` to `to` over `seconds` while the simulation runs — the
   *  motion in the motion graphic: the student watches the cause and the effect move together. */
  z.object({
    t: z.literal('animate'),
    object: z.string().min(1).max(60),
    param: z.string().min(1).max(40),
    from: z.number(),
    to: z.number(),
    seconds: z.number().min(1).max(30).default(6),
    text: z.string().max(300).optional(),
  }),
  /** Step an algorithm stepper (Step Lab) through its frames, narrating the ENGINE's own commentary for each — the
   *  explanation of what happens at every step is computed by the same code that draws it. */
  z.object({ t: z.literal('lab'), object: z.string().min(1).max(60), steps: z.number().int().min(2).max(40).default(10) }),
  /** Step a program in the DSA Lab, speaking one sentence at each of the chosen steps. The narration is written when the
   *  film is built (from the real trace), so playback is data; the step numbers are the interpreter's own. */
  z.object({ t: z.literal('code'), object: z.string().min(1).max(60), narration: z.array(z.object({ step: z.number().int().min(0), text: z.string().min(3).max(300) })).min(1).max(24) }),
  /** Let the simulation run for a while. */
  z.object({ t: z.literal('run'), seconds: z.number().min(0.5).max(30).default(4) }),
  /** Freeze and ask: the student commits, THEN the answer is shown (and, if `demo`, run). */
  z.object({
    t: z.literal('predict'),
    id: z.string().min(1),
    prompt: z.string().min(1).max(500),
    choices: z.array(z.string().min(1).max(300)).min(2).max(5),
    correct: z.number().int().min(0),
    /** One explanation per choice — wrong answers explain the intuition behind them, never scold. */
    responses: z.array(z.string().max(500)),
    /** A scene that demonstrates the answer, shown after the student commits. */
    demo: z.string().optional(),
  }),
])
export type Beat = z.infer<typeof beatSchema>

export const storyboardSchema = z.object({
  title: z.string().min(1).max(160),
  /** Where it came from — a course lesson id, or 'authored'. */
  source: z.string().max(200).optional(),
  beats: z.array(beatSchema).min(1).max(400),
})
export type Storyboard = z.infer<typeof storyboardSchema>

const words = (s: string) => s.trim().split(/\s+/).length

/** Every reason this storyboard cannot be played well. Empty = good. */
export function lintStoryboard(sb: Storyboard): string[] {
  const out: string[] = []
  sb.beats.forEach((b, i) => {
    const at = `beat ${i + 1} (${b.t})`
    if (b.t === 'say' && words(b.text) > 60) out.push(`${at}: narration is ${words(b.text)} words — split it; it is read aloud`)
    if (b.t === 'scene' || (b.t === 'predict' && b.demo)) {
      const script = b.t === 'scene' ? b.script : (b as { demo: string }).demo
      const r = lintSimScript(script)
      if (!r.ok) out.push(`${at}: SimScript — ${r.errors[0]}`)
    }
    if (b.t === 'code' && b.narration.some((n, k) => k > 0 && n.step < b.narration[k - 1].step)) out.push(`${at}: steps must run forward`)
    if (b.t === 'animate' && b.from === b.to) out.push(`${at}: sweeps nothing (from equals to)`)
    if (b.t === 'predict') {
      if (b.correct >= b.choices.length) out.push(`${at}: correct index ${b.correct} is out of range`)
      if (b.responses.length !== b.choices.length) out.push(`${at}: needs one response per choice`)
    }
  })
  if (!sb.beats.some((b) => b.t === 'say')) out.push('no narration at all')
  return out
}

/** Rough spoken length in seconds (150 wpm) — for the progress bar and for budgeting. */
export const durationOf = (sb: Storyboard) =>
  Math.round(sb.beats.reduce((a, b) => a + (b.t === 'say' ? (words(b.text) / 150) * 60 : b.t === 'equation' ? 4 + (b.text ? (words(b.text) / 150) * 60 : 0) : b.t === 'run' ? b.seconds : b.t === 'lab' ? b.steps * 5 : b.t === 'code' ? b.narration.length * 5 : b.t === 'animate' ? b.seconds : b.t === 'point' ? 3 : b.t === 'scene' ? 3 : b.t === 'title' ? 2 : 6), 0))
