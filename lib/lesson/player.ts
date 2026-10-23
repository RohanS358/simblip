// The sequencer: performs a Storyboard through a Stage. Pure — the Stage is the
// only thing that touches the canvas, the voice or the learner store, so the
// ordering rules (pause, seek, predict-then-reveal) are tested without a browser.

import type { Beat, Storyboard } from './storyboard'

export interface Stage {
  /** Narrate + caption; resolves when the line is finished (or its reading time has passed). */
  say(text: string, instant?: boolean): Promise<void>
  title(text: string, sub?: string, instant?: boolean): Promise<void>
  /** Put a simulation on the board. `clear` opens a NEW SECTION further down the board (the camera
   *  moves to it; the older sections stay for the student to look back at) and stops any running
   *  simulation. `instant` skips the drawing-in and the camera move — used to rebuild after a seek. */
  scene(script: string, clear: boolean, caption?: string, opts?: { instant?: boolean; section?: string }): Promise<void>
  equation(latex: string, text?: string, instant?: boolean): Promise<void>
  run(seconds: number): Promise<void>
  /** Glide the cursor to a named object, ring it, and say `text`. */
  point(object: string, text: string): Promise<void>
  /** Page tour: frame these objects of the open page and make them glow. */
  focus?(ids: string[], pageId?: string): Promise<void>
  /** Page tour of a PDF: turn the reader to this page. */
  turn?(n: number): Promise<void>
  /** Step a Step Lab stepper through up to `steps` frames, speaking each frame's commentary. */
  lab(object: string, steps: number): Promise<void>
  /** Step a DSA Lab program to each narrated step, speaking its sentence. */
  code(object: string, narration: { step: number; text: string }[]): Promise<void>
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
  /** After an instant rebuild: bring the camera to the newest section. */
  settle?(): Promise<void>
  /** The lesson ran to its end: the stage may close the board with a summary. */
  finish?(): Promise<void>
  /** Offered before each chapter after the first: the teacher may check in with the student. */
  checkpoint?(index: number): Promise<void>
}

/** Beats that must be re-applied to reach beat `index` after a seek. The board keeps EVERY section, so
 *  all the chapter names, scenes, equations and study-note lines before the point are rebuilt (instantly), not just the
 *  latest scene: seeking forward must not lose the sections the student would have seen on the way. */
export function catchUp(sb: Storyboard, index: number): Beat[] {
  return sb.beats.slice(0, Math.max(0, Math.min(index, sb.beats.length))).flatMap((b): Beat[] => {
    if (b.t === 'title' || b.t === 'scene' || b.t === 'equation' || b.t === 'say') return [b]
    if (b.t === 'predict' && b.demo) return [{ t: 'scene', script: b.demo, clear: true, caption: 'Watch it happen' }]
    return []
  })
}

export async function perform(sb: Storyboard, stage: Stage, from = 0, opts: { rebuild?: boolean } = {}): Promise<'done' | 'stopped'> {
  for (const b of opts.rebuild === false ? [] : catchUp(sb, from)) {
    if (b.t === 'title') await stage.title(b.text, b.sub, true)
    else if (b.t === 'scene') await stage.scene(b.script, b.clear, b.caption, { instant: true, section: b.caption === 'Watch it happen' ? b.caption : undefined })
    else if (b.t === 'equation') await stage.equation(b.latex, b.text, true)
    else if (b.t === 'say') await stage.say(b.text, true)
  }
  if (from > 0 && opts.rebuild !== false) await stage.settle?.()
  for (let i = from; i < sb.beats.length; i++) {
    if (!stage.alive()) return 'stopped'
    await stage.gate()
    if (!stage.alive()) return 'stopped'
    stage.onBeat(i)
    const b = sb.beats[i]
    if (b.t === 'title' && i > from) { await stage.checkpoint?.(i); if (!stage.alive()) return 'stopped' }
    switch (b.t) {
      case 'title': await stage.title(b.text, b.sub); break
      case 'say': await stage.say(b.text); break
      case 'scene': await stage.scene(b.script, b.clear, b.caption); break
      case 'equation': await stage.equation(b.latex, b.text); break
      case 'run': await stage.run(b.seconds); break
      case 'point': await stage.point(b.object, b.text); break
      case 'focus': await stage.focus?.(b.ids, b.pageId); break
      case 'page': await stage.turn?.(b.n); break
      case 'code': await stage.code(b.object, b.narration); break
      case 'lab': await stage.lab(b.object, b.steps); break
      case 'animate': await stage.animate(b.object, b.param, b.from, b.to, b.seconds, b.text); break
      case 'predict': {
        const chosen = await stage.ask(b)
        if (!stage.alive()) return 'stopped'
        stage.record(b, chosen)
        // Explain the choice they made — a wrong one gets the reason it is appealing, not a score.
        await stage.say(b.responses[chosen] ?? '')
        if (chosen !== b.correct) await stage.say(`The answer is: ${b.choices[b.correct]}. ${b.responses[b.correct]}`)
        if (b.demo) { await stage.scene(b.demo, true, 'Watch it happen', { section: 'Watch it happen' }); await stage.run(4) }
        break
      }
    }
  }
  if (stage.alive()) await stage.finish?.()
  return stage.alive() ? 'done' : 'stopped'
}
