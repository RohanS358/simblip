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
import { lintStoryboard, storyboardSchema, type Beat, type Storyboard } from './storyboard'
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
export interface DirectorDeps { llm: Llm; runner: Runner; level: Level; onProgress?: (msg: string) => void; signal?: AbortSignal }

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

/** The planner declined: it does not know the topic well enough to teach it. Shown to the student as a question. */
export class NeedsClarification extends Error {}

export async function planTopic(llm: Llm, topic: string, level: Level, jsonSchema: object, signal?: AbortSignal): Promise<Plan> {
  let note = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await llm.complete(planSystemPrompt(level), planUserPrompt(topic) + note, { jsonSchema, signal })
    const r = parsePlan(text)
    if (r.ok) {
      if (r.plan.unsure) throw new NeedsClarification(r.plan.unsure)
      return r.plan
    }
    note = `\n\nYour previous reply was invalid: ${r.error}`
  }
  throw new Error(`Could not get a usable lesson plan for "${topic}".`)
}

export async function directLesson(topic: string, plan: Plan, d: DirectorDeps): Promise<{ storyboard: Storyboard; warnings: string[] }> {
  const beats: Beat[] = [{ t: 'title', text: plan.title, sub: topic }]
  const warnings: string[] = []
  let scenes = 0
  for (const [i, step] of plan.steps.entries()) {
    if (d.signal?.aborted) throw new Error('cancelled')
    d.onProgress?.(`Step ${i + 1} of ${plan.steps.length}: ${step.heading}`)
    beats.push({ t: 'title', text: step.heading })
    for (const text of step.say) beats.push({ t: 'say', text })

    let script: string | undefined
    let ground: Ground | undefined
    if (step.scene) {
      try {
        script = await d.llm.script(step.scene, d.signal)
        const lint = lintSimScript(script) // defence in depth: whatever produced it, only verified SimScript is drawn
        if (!lint.ok) throw new Error(lint.errors[0])
        script = lint.cleaned
        ground = await d.runner.ground(script)
        if (!ground.ok) { warnings.push(`step ${i + 1}: scene did not run (${ground.error})`); script = undefined }
      } catch (e) { warnings.push(`step ${i + 1}: scene failed (${e instanceof Error ? e.message : e})`); script = undefined }
    }
    if (script && ground) {
      scenes++
      beats.push({ t: 'scene', script, caption: step.scene, clear: true })
      // What the instruments really read — measured, so the narration can quote it.
      const inst = ground.objects.find((o) => INSTRUMENTS.test(o.name) || INSTRUMENTS.test(o.kind))
      if (inst) beats.push({ t: 'point', object: inst.name, text: 'This instrument reads the live value.' })
      // Only values that settled are quoted, so every number the narration states is one the
      // student will actually see on the instrument.
      const reads = ground.readings.filter((r) => !r.channel.includes('.')).slice(0, 3).map((r) => `the ${r.object}'s ${channelName(r.channel)} ${r.channel.includes('.') ? 'reaches' : 'settles at'} ${fmt(r.value, r.channel)}`)
      if (reads.length) beats.push({ t: 'run', seconds: 3 }, { t: 'say', text: `With these values, ${reads.join(', and ')}.` })
    }
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
