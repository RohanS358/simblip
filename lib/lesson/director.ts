// The Director: topic → Storyboard, for topics with no authored lesson.
//
//   plan (big model, one JSON call)
//     → per step: scene (fine-tuned model writes SimScript; lint + real engine run verify it)
//                 numbers (the simulator measures; the model never states a result)
//                 experiment (model PROPOSES a change; the simulator runs before/after,
//                             and the correct answer is whatever the simulator showed)
//     → lint the storyboard → play.
//
// Grounding is the point: a 7B model is wrong about physics sometimes, so it is only
// allowed to choose WHAT to show — never what the result is. Pure: the model and the
// simulator are injected, so ordering and grounding are tested without either.

import { lintSimScript } from '@/lib/ai/simscript-lint'
import { getEngine, runEngine } from '@/lib/steplab/registry'
import { runCpp } from '@/lib/dsa/interpreter'
import { capabilityPrompt, isComputing, matchLabs } from './catalog'
import { lintStoryboard, storyboardSchema, type Beat, type Storyboard } from './storyboard'
import { circuitRecipe } from './recipes'
import { parsePlan, planSystemPrompt, planUserPrompt, type Level, type Plan } from './plan'

export interface SceneObject { name: string; kind: string; params: Record<string, number>; channels: string[] }
export interface Ground { ok: boolean; error?: string; objects: SceneObject[]; readings: { object: string; channel: string; value: number }[] }
export interface Change { object: string; param: string; to: number }
export interface Watch { object: string; channel: string }

export interface Llm {
  /** One chat call returning raw text. Constrained to JSON when `jsonSchema` is given. */
  complete(system: string, user: string, opts?: { jsonSchema?: object; signal?: AbortSignal }): Promise<string>
  /** SimScript for a scene request — already lint-verified/repaired by the script lane. */
  script(request: string, signal?: AbortSignal): Promise<string>
}
export interface Runner {
  /** Draw on a scratch page, run briefly, and report what is there and what the instruments read. */
  ground(script: string): Promise<Ground>
  /** Run the scene as drawn, then with `change` applied; report `watch` before and after. */
  experiment(script: string, change: Change, watch: Watch): Promise<{ before: number; after: number; base: number; moved: boolean } | null>
}
export interface DirectorDeps { llm: Llm; runner: Runner; level: Level; onProgress?: (msg: string) => void; signal?: AbortSignal
  /** Draw a small concept diagram for a step the simulator cannot show, so every section has a picture. */
  diagrams?: boolean }

// ── number formatting ───────────────────────────────────────────────────────
const CHANNEL_NAME: Record<string, string> = { I: 'current', V: 'voltage', P: 'power', x: 'horizontal position', y: 'height', speed: 'speed', omega: 'angular speed', ke: 'kinetic energy', angle: 'angle', vx: 'horizontal speed', vy: 'vertical speed' }
/** "I" → "current"; "speed.max" → "peak speed". */
export function channelName(spec: string): string {
  const [c, stat] = spec.split('.')
  return `${stat === 'max' ? 'peak ' : stat === 'min' ? 'lowest ' : ''}${CHANNEL_NAME[c] ?? c}`
}
const up = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const baseChannel = (spec: string) => spec.split('.')[0]
const UNIT: Record<string, string> = { V: 'V', I: 'A', P: 'W', R: 'Ω', C: 'F', L: 'H', f: 'Hz', t: 's', x: 'cm', y: 'cm', speed: 'cm/s', vx: 'cm/s', vy: 'cm/s', ke: 'J', angle: '°' }
export function fmt(value: number, channel: string): string {
  const u = UNIT[baseChannel(channel)] ?? ''
  if (!u || u === '°' || u === 'cm' || u === 'cm/s') return `${Number(value.toPrecision(3))}${u ? ' ' + u : ''}`
  const a = Math.abs(value)
  const prefixes: [number, string][] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']]
  const [scale, p] = a === 0 ? [1, ''] : prefixes.find(([s]) => a >= s) ?? prefixes[prefixes.length - 1]
  return `${Number((value / scale).toPrecision(3))} ${p}${u}`
}

/** Is the object a measuring instrument or a plain part? Instruments are what we point at and read. */
const INSTRUMENTS = /meter|probe|scope|sensor|gauge/i

const OPTIONS = ['It increases.', 'It decreases.', 'It stays about the same.'] as const
const verdict = (before: number, after: number): 0 | 1 | 2 => {
  const scale = Math.max(Math.abs(before), Math.abs(after), 1e-12)
  const rel = (after - before) / scale
  return rel > 0.05 ? 0 : rel < -0.05 ? 1 : 2
}

const proposalSystem = (objs: SceneObject[]) => `You choose ONE experiment on a simulation. Reply with JSON only: {"object": string, "param": string, "to": number, "watch_object": string, "watch_channel": string}.
Prefer a slider's "value" when the scene has one: moving it is exactly what the student would do.
Objects and their numeric parameters:
${objs.map((o) => `- ${o.name} (${o.kind}): ${Object.entries(o.params).map(([k, v]) => `${k}=${v}`).join(', ') || 'no numeric parameters'}; channels you may watch (plain = settles to a steady value, ".max" = its peak over the run): ${o.channels.join(', ') || 'none'}`).join('\n')}
"object"/"param" must exist above. "watch_object"/"watch_channel" must be a readable channel above. "to" is the new value.`

interface Proposal { change: Change; watch: Watch }

/** Things the student can meaningfully change or watch: not frames, notes, graphs or text. */
const CHANGEABLE = (o: SceneObject) => !/^(rect|note|graph|text|formula|chart|table|line)$/.test(o.kind) && (Object.keys(o.params).length > 0 || o.channels.length > 0)

async function propose(llm: Llm, all: SceneObject[], experiment: string, signal?: AbortSignal): Promise<Proposal | string> {
  const objs = all.filter(CHANGEABLE)
  let note = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await llm.complete(proposalSystem(objs), `Change to make: ${experiment}${note ? `\nYour last answer was invalid: ${note}` : ''}`, { signal })
      const j = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? '') as Record<string, unknown>
      const o = objs.find((x) => x.name === j.object)
      const w = objs.find((x) => x.name === j.watch_object)
      const to = Number(j.to)
      if (!o || !(String(j.param) in o.params)) note = `no such object/parameter "${j.object}.${j.param}"`
      else if (!Number.isFinite(to) || to === o.params[String(j.param)]) note = '"to" must be a different number'
      else if (!w || !w.channels.includes(String(j.watch_channel))) note = `"${j.watch_object}" has no channel "${j.watch_channel}"`
      else return { change: { object: o.name, param: String(j.param), to }, watch: { object: w.name, channel: String(j.watch_channel) } }
    } catch {
      note = 'not valid JSON'
    }
  }
  return note
}

const DIAGRAM_SYSTEM = `You draw a small concept diagram for one step of a lesson, in a tiny text language. Reply with the diagram lines ONLY — no code fences, no commentary.

Language:
  direction: right            (first line; "right" or "down")
  [Short label] as a #blue    (a box: 2-5 words, a short id, a colour: blue mint amber violet rose)
  a -> b : verb               (an arrow, with an optional word)

Rules: 3 to 6 boxes. Show how the ideas of the step connect (cause and effect, a process, parts of a whole). Labels are plain words, no formulas, no quotes. Example:
direction: right
[Electrons as waves] as w #blue
[Pass two slits] as s #mint
[Interference pattern] as p #amber
w -> s : travel
s -> p : overlap`

/** A concept diagram for a step, as verified SimScript — or null when the model's diagram does not parse/run. */
export async function conceptDiagram(d: DirectorDeps, step: Plan['steps'][number]): Promise<string | null> {
  try {
    const text = await d.llm.complete(DIAGRAM_SYSTEM, `Step: ${step.heading}\nWhat is said: ${step.say.join(' ')}`, { signal: d.signal })
    const lines = text.replace(/```[a-z]*/gi, '').split('\n').map((l) => l.trim()).filter(Boolean)
    const src = lines.filter((l) => /^direction:/i.test(l) || /^\[.+\]\s+as\s+\w+/.test(l) || /^\w+\s*->\s*\w+/.test(l)).join('\n')
    if (!/\]\s+as\s+\w+/.test(src) || !/->/.test(src)) return null
    const script = `diagram(${JSON.stringify(src)});`
    const lint = lintSimScript(script)
    if (!lint.ok) return null
    const ground = await d.runner.ground(lint.cleaned)
    return ground.ok ? lint.cleaned : null
  } catch {
    return null
  }
}


// ── Algorithm steppers and the DSA Lab ──────────────────────────────────────
// For computing topics the director does not ask a physics model to draw anything: it builds a Step Lab scene (the
// engine's own commentary narrates it) or writes a short C++ program for the DSA Lab (the interpreter's real trace is
// stepped, and the narration is written from that trace). Both are validated by RUNNING them.

type Built = { script: string; beats: Beat[] } | { error: string }

export function buildLab(lab: { engine: string; settings?: Record<string, string> }): Built {
  const engine = getEngine(lab.engine)
  if (!engine) return { error: `no Step Lab engine called "${lab.engine}"` }
  const known = new Set(engine.params.map((p) => p.name))
  const settings = Object.fromEntries(Object.entries(lab.settings ?? {}).filter(([k, v]) => known.has(k) && typeof v === 'string' && v.length <= 400))
  let r = runEngine({ engine: engine.id, ...settings })
  let used = settings
  if (!r.ok && Object.keys(settings).length) { r = runEngine({ engine: engine.id }); used = {} } // a wrong setting must not cost the whole step
  if (!r.ok) return { error: `${engine.label} would not run (${r.error})` }
  const script = `var lab = create("steplab", ${JSON.stringify({ engine: engine.id, ...used, name: 'lab', width: 600, height: 440 })});`
  return { script, beats: [{ t: 'lab', object: 'lab', steps: Math.max(2, Math.min(12, r.trace.frames.length)) }] }
}

const NARRATE_SYSTEM = `You narrate a C++ program being executed step by step, to a student. For EACH step given, write ONE friendly sentence (at most 22 words) saying what is happening and why, using only the facts given. Reply with JSON only: {"lines":[{"step":<number>,"text":"..."}]} with exactly one entry per step, in order.`
const FIX_SYSTEM = `You fix a C++ program so it compiles and runs in a small teaching interpreter (iostream, vector, stack, queue, unordered_map, string only; int main). Reply with the corrected program only, no commentary, no markdown fences.`

const lineOf = (source: string, n: number) => (source.split('\n')[n - 1] ?? '').trim()

export async function buildCode(d: DirectorDeps, source: string, goal: string): Promise<Built> {
  let src = source
  let run = runCpp(src)
  if ((run.error || !run.steps.length || run.truncated) && !d.signal?.aborted) {
    // One repair round, with the interpreter's own message — the same loop that repairs SimScript.
    const fixed = (await d.llm.complete(FIX_SYSTEM, `Error: ${run.error?.message ?? 'the program did nothing'} (line ${run.error?.line ?? '?'})\n\n${src}`, { signal: d.signal })).replace(/```[a-z+]*/gi, '').trim()
    if (fixed.includes('main')) { src = fixed; run = runCpp(src) }
  }
  if (run.error || !run.steps.length || run.truncated) return { error: `the program did not run cleanly (${run.error?.message ?? (run.truncated ? 'it ran too long' : 'no steps')})` }
  const script = `var lab = create("dsa", ${JSON.stringify({ source: src, name: 'lab', width: 780, height: 520 })});`
  const lint = lintSimScript(script)
  if (!lint.ok) return { error: `the DSA scene did not pass checks (${lint.errors[0]})` }

  // The steps worth stopping at: where something is compared, called, returned, allocated or printed — evenly spread, ≤ 9, first and last included.
  const key = run.steps.map((st, i) => ({ st, i })).filter(({ st, i }) => i === 0 || i === run.steps.length - 1 || ['compare', 'call', 'return', 'alloc', 'io'].includes(st.kind) || st.changed.length > 0)
  const n = Math.min(9, key.length)
  const picks = n === key.length ? key : Array.from({ length: n }, (_, k) => key[Math.round((k * (key.length - 1)) / (n - 1))])
  const facts = picks.map(({ st, i }) => ({ step: i, line: lineOf(src, st.line), what: st.desc, ...(st.output ? { output_so_far: st.output.slice(-80) } : {}) }))

  // The model words each step; the facts and the step numbers are the interpreter's. If it cannot, say the facts plainly.
  let narration = picks.map(({ st, i }) => ({ step: i, text: `${st.desc}.`.replace(/\.\.$/, '.') }))
  try {
    const text = await d.llm.complete(NARRATE_SYSTEM, `Goal: ${goal}\nProgram:\n${src}\n\nSteps:\n${JSON.stringify(facts)}`, { signal: d.signal })
    const lines = (JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '') as { lines?: { step: number; text: string }[] }).lines ?? []
    const byStep = new Map(lines.map((l) => [l.step, String(l.text).trim()]))
    if (picks.every(({ i }) => (byStep.get(i) ?? '').length >= 3)) narration = picks.map(({ i }) => ({ step: i, text: (byStep.get(i) as string).slice(0, 280) }))
  } catch { /* keep the plain facts */ }
  return { script, beats: [{ t: 'code', object: 'lab', narration }] }
}

/** The planner declined: it does not know the topic well enough to teach it. Shown to the student as a question. */
export class NeedsClarification extends Error {}

export async function planTopic(llm: Llm, topic: string, level: Level, jsonSchema: object, signal?: AbortSignal): Promise<Plan> {
  let note = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await llm.complete(planSystemPrompt(level, capabilityPrompt(topic)), planUserPrompt(topic) + note, { jsonSchema, signal })
    const r = parsePlan(text, topic)
    if (r.ok) {
      if (r.plan.unsure) throw new NeedsClarification(r.plan.unsure)
      return r.plan
    }
    note = `\n\nYour previous reply was invalid: ${r.error}`
  }
  throw new Error(`Could not get a usable lesson plan for "${topic}".`)
}


const PROGRAM_SYSTEM = `You write ONE short C++ program that teaches a topic by running. Rules: under 30 lines, int main, only iostream, vector, stack, queue, unordered_map and string, small fixed inputs, print what matters with cout. Reply with the program only, no commentary, no markdown fences.`

/** Decide, in code, what picture each step gets for a computing topic: the registry's stepper when the topic names one, else one
 *  C++ program for the DSA Lab; and no physics scene for any step of such a topic. The planner model is never trusted to remember. */
export async function routePlan(topic: string, plan: Plan, d: Pick<DirectorDeps, 'llm' | 'signal'>): Promise<Plan> {
  const labs = matchLabs(topic)
  const computing = labs.length > 0 || isComputing(topic)
  if (!computing) return plan
  const steps = plan.steps.map((s) => ({ ...s, scene: undefined, experiment: undefined })) // nothing here is a physics scene
  const slots = steps.length >= 4 ? [1, 3] : steps.length >= 2 ? [1, 0] : [0]
  if (labs.length) {
    labs.slice(0, slots.length).forEach((m, k) => { steps[slots[k]] = { ...steps[slots[k]], lab: { engine: m.cap.id, ...(Object.keys(m.settings).length ? { settings: m.settings } : {}) }, code: undefined } })
  } else {
    try {
      const code = (await d.llm.complete(PROGRAM_SYSTEM, `Topic: ${topic}`, { signal: d.signal })).replace(/```[a-z+]*/gi, '').trim()
      if (code.includes('main') && code.length >= 20 && code.length <= 1800) steps[slots[0]] = { ...steps[slots[0]], code }
    } catch { /* the lesson is still taught, with concept diagrams */ }
  }
  return { ...plan, steps }
}

export async function directLesson(topic: string, planned: Plan, d: DirectorDeps): Promise<{ storyboard: Storyboard; warnings: string[] }> {
  const plan = await routePlan(topic, planned, d)
  const beats: Beat[] = [{ t: 'title', text: plan.title, sub: topic }]
  const warnings: string[] = []
  let scenes = 0
  // After a recipe circuit has been drawn, the steps that go on about its parts and numbers are about THAT picture: they
  // get their own slide showing the same circuit. (Asking the model for a fresh scene for each is how a parallel
  // lesson ends up over a series loop.)
  let recipeOnBoard = null as string | null // the script of the recipe circuit last drawn
  for (const [i, step] of plan.steps.entries()) {
    if (d.signal?.aborted) throw new Error('cancelled')
    d.onProgress?.(`Step ${i + 1} of ${plan.steps.length}: ${step.heading}`)
    beats.push({ t: 'title', text: step.heading })
    // The picture comes first and the words after it: the board writes each section as title, picture, then
    // what is said about it, so the narration belongs to the section whose picture it is explaining.
    let said = false
    const say = () => { if (!said) { said = true; for (const text of step.say) beats.push({ t: 'say', text }) } }

    let script: string | undefined
    let ground: Ground | undefined
    // A stepper or a program for the DSA Lab, built here rather than drawn by a physics model.
    if (step.lab || step.code) {
      const built = step.lab ? buildLab(step.lab) : await buildCode(d, step.code as string, `${step.heading}. ${step.say.join(' ')}`)
      if ('error' in built) warnings.push(`step ${i + 1}: ${step.lab ? 'Step Lab' : 'DSA Lab'} left out (${built.error})`)
      else {
        scenes++
        beats.push({ t: 'scene', script: built.script, caption: step.heading, clear: true })
        say()
        beats.push(...built.beats)
        if (step.equation) beats.push({ t: 'equation', latex: step.equation })
        continue
      }
    }
    const recipe = step.scene ? circuitRecipe(step.scene) : null
    const samePicture: boolean = !!recipeOnBoard && !recipe && !!step.scene && /\b(r\d|resistors?|bulbs?|lamps?|branch(es)?|current|voltage|battery|parallel|series|circuit)\b/i.test(step.scene)
    if (step.scene) {
      try {
        // A plain series/parallel circuit is written exactly; anything else is the model's to draw.
        script = recipe ?? (samePicture ? (recipeOnBoard as string) : await d.llm.script(step.scene, d.signal))
        const lint = lintSimScript(script) // defence in depth: whatever produced it, only verified SimScript is drawn
        if (!lint.ok) throw new Error(lint.errors[0])
        script = lint.cleaned
        ground = await d.runner.ground(script)
        if (!ground.ok) { warnings.push(`step ${i + 1}: scene did not run (${ground.error})`); script = undefined }
      } catch (e) { warnings.push(`step ${i + 1}: scene failed (${e instanceof Error ? e.message : e})`); script = undefined }
    }
    if (script && ground) {
      recipeOnBoard = recipe ?? (samePicture ? recipeOnBoard : null)
      scenes++
      beats.push({ t: 'scene', script, caption: step.scene, clear: true })
      say()
      // What the instruments really read — measured, so the narration can quote it.
      const inst = ground.objects.find((o) => INSTRUMENTS.test(o.name) || INSTRUMENTS.test(o.kind))
      if (inst) beats.push({ t: 'point', object: inst.name, text: 'This instrument reads the live value.' })
      // Only values that settled are quoted, so every number the narration states is one the
      // student will actually see on the instrument.
      const reads = ground.readings.filter((r) => !r.channel.includes('.')).slice(0, 3).map((r) => `the ${r.object}'s ${channelName(r.channel)} ${r.channel.includes('.') ? 'reaches' : 'settles at'} ${fmt(r.value, r.channel)}`)
      if (reads.length) beats.push({ t: 'run', seconds: 3 }, { t: 'say', text: `With these values, ${reads.join(', and ')}.` })
    }
    // No simulation for this step: a concept diagram still gives it a picture beside its words.
    if (!script && d.diagrams) {
      const diagram = await conceptDiagram(d, step)
      if (diagram) beats.push({ t: 'scene', script: diagram, caption: step.heading, clear: true })
    }
    say() // (a step with no picture just speaks)
    if (step.equation) beats.push({ t: 'equation', latex: step.equation })

    if (script && ground && step.experiment) {
      const watchable = ground.objects.filter((o) => o.channels.length)
      const proposal = watchable.length ? await propose(d.llm, ground.objects, step.experiment, d.signal) : 'nothing in the scene settles to a measurable value'
      const p = typeof proposal === 'string' ? null : proposal
      const res = p && (await d.runner.experiment(script, p.change, p.watch))
      if (p && res && !res.moved) warnings.push(`step ${i + 1}: changing ${p.change.object}.${p.change.param} moved nothing in the simulation, so it was not taught`)
      else if (p && res) {
        const right = verdict(res.before, res.after)
        const was = ground.objects.find((o) => o.name === p.change.object)?.params[p.change.param] ?? res.base
        const what = p.change.param === 'value' ? `the ${p.change.object} slider moved` : `${p.change.object}'s ${p.change.param} changed`
        const moving = p.watch.channel.includes('.') // a peak over a run: its absolute size depends on the instant, so say how much it CHANGED
        const pct = Math.round((Math.abs(res.after - res.before) / Math.max(Math.abs(res.before), 1e-12)) * 100)
        const fact = moving
          ? `the ${channelName(p.watch.channel)} of ${p.watch.object} ${right === 2 ? 'barely changed' : `${right === 0 ? 'rose' : 'fell'} by about ${pct}%`} when ${what} from ${Number(was.toPrecision(4))} to ${p.change.to}.`
          : `${p.watch.object}'s ${channelName(p.watch.channel)} went from ${fmt(res.before, p.watch.channel)} to ${fmt(res.after, p.watch.channel)} when ${what} from ${Number(was.toPrecision(4))} to ${p.change.to}.`
        beats.push({
          t: 'predict',
          id: `exp-${i}`,
          prompt: `Now ${step.experiment.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/[.?!]$/, '')}. What happens to the ${channelName(p.watch.channel)} of ${p.watch.object}?`,
          choices: [...OPTIONS],
          correct: right,
          // Wrong answers explain what the simulator showed — never a scolding, never a model's guess.
          responses: OPTIONS.map((_, c) => (c === right ? `Yes. ${up(fact)}` : `A fair guess, but the simulation shows otherwise: ${fact}`)),
        })
        beats.push({ t: 'animate', object: p.change.object, param: p.change.param, from: was, to: p.change.to, seconds: 6, text: `Watch ${p.watch.object} as ${p.change.param === 'value' ? `the ${p.change.object} slider` : p.change.param} moves.` })
      } else if (!p || !res) warnings.push(`step ${i + 1}: experiment left out (${typeof proposal === 'string' ? proposal : 'the run produced no reading'})`)
    }
  }
  if (scenes === 0) {
    // Nothing here could be drawn or measured, so nothing is checked by the simulator. Still teach it — but say so,
    // out loud and on screen, rather than pass unverified claims off as demonstrated ones.
    beats.splice(1, 0, { t: 'title', text: 'Explained without a simulation', sub: 'This one is not checked by the simulator — verify it against your course notes.' }, { t: 'say', text: 'A heads-up: I could not build a simulation for this topic, so what follows is explained in words and is not checked by the simulator. Please verify it against your course notes.' })
    warnings.push('no scene could be built; delivered as an unverified, text-only lesson')
  }
  const storyboard = storyboardSchema.parse({ title: plan.title, source: `generated:${topic}`, beats })
  const issues = lintStoryboard(storyboard)
  if (issues.length) throw new Error(`The generated lesson did not pass checks: ${issues[0]}`)
  return { storyboard, warnings }
}
