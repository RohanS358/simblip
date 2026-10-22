// The sequencer: performs a Storyboard through a Stage. Pure — the Stage is the
// only thing that touches the canvas, the voice or the learner store, so the
// ordering rules (pause, seek, predict-then-reveal) are tested without a browser.

import type { Beat, Storyboard } from './storyboard'

export interface Stage {
  /** Narrate + caption; resolves when the line is finished (or its reading time has passed). */
  say(text: string): Promise<void>
  title(text: string, sub?: string): Promise<void>
  /** Put a simulation on the canvas. `clear` removes the previous scene (and stops it) first. */
  scene(script: string, clear: boolean, caption?: string): Promise<void>
  equation(latex: string, text?: string): Promise<void>
  run(seconds: number): Promise<void>
  /** Glide the cursor to a named object, ring it, and say `text`. */
  point(object: string, text: string): Promise<void>
  /** Sweep a parameter while the simulation runs; `text` is narrated over it. */
  animate(object: string, param: string, from: number, to: number, seconds: number, text?: string): Promise<void>
  /** Freeze and wait for the student's choice (index). */
  ask(beat: Extract<Beat, { t: 'predict' }>): Promise<number>
  /** Record the outcome (spaced-repetition card + mastery on a miss). */
  record(beat: Extract<Beat, { t: 'predict' }>, chosen: number): void
  /** Called as each beat starts — drives the progress bar. */
  onBeat(index: number): void
  /** False once the viewer closed the lesson or started another one. */
  alive(): boolean
  /** Resolves when not paused. */
  gate(): Promise<void>
}

/** Beats that must be re-applied to reach beat `index` after a seek: the latest scene and
 *  the equations shown since it. Without this, "next" would narrate a circuit that is not there. */
export function catchUp(sb: Storyboard, index: number): Beat[] {
  let sceneAt = -1
  for (let i = Math.min(index, sb.beats.length) - 1; i >= 0; i--) if (sb.beats[i].t === 'scene') { sceneAt = i; break }
  return sceneAt < 0 ? [] : sb.beats.slice(sceneAt, index).filter((b) => b.t === 'scene' || b.t === 'equation')
}

export async function perform(sb: Storyboard, stage: Stage, from = 0): Promise<'done' | 'stopped'> {
  for (const b of catchUp(sb, from)) {
    if (b.t === 'scene') await stage.scene(b.script, b.clear, b.caption)
    else if (b.t === 'equation') await stage.equation(b.latex)
  }
  for (let i = from; i < sb.beats.length; i++) {
    if (!stage.alive()) return 'stopped'
    await stage.gate()
    if (!stage.alive()) return 'stopped'
    stage.onBeat(i)
    const b = sb.beats[i]
    switch (b.t) {
      case 'title': await stage.title(b.text, b.sub); break
      case 'say': await stage.say(b.text); break
      case 'scene': await stage.scene(b.script, b.clear, b.caption); break
      case 'equation': await stage.equation(b.latex, b.text); break
      case 'run': await stage.run(b.seconds); break
      case 'point': await stage.point(b.object, b.text); break
      case 'animate': await stage.animate(b.object, b.param, b.from, b.to, b.seconds, b.text); break
      case 'predict': {
        const chosen = await stage.ask(b)
        if (!stage.alive()) return 'stopped'
        stage.record(b, chosen)
        // Explain the choice they made — a wrong one gets the reason it is appealing, not a score.
        await stage.say(b.responses[chosen] ?? '')
        if (chosen !== b.correct) await stage.say(`The answer is: ${b.choices[b.correct]}. ${b.responses[b.correct]}`)
        if (b.demo) { await stage.scene(b.demo, true, 'Watch it happen'); await stage.run(4) }
        break
      }
    }
  }
  return stage.alive() ? 'done' : 'stopped'
}
