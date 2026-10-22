// Which lines of a film will be SPOKEN next — so their audio can be fetched while the current line plays,
// and the voice never waits on the network between beats. Pure.

import type { Storyboard } from './storyboard'

export function upcomingLines(sb: Storyboard, from: number, count = 4): string[] {
  const out: string[] = []
  for (let i = from; i < sb.beats.length && out.length < count; i++) {
    const b = sb.beats[i]
    if (b.t === 'say' || b.t === 'point') out.push(b.text)
    else if (b.t === 'title') out.push(b.text)
    else if (b.t === 'equation' && b.text) out.push(b.text)
    else if (b.t === 'animate' && b.text) out.push(b.text)
    else if (b.t === 'predict') out.push(b.prompt, ...b.responses) // answers are spoken the instant the student picks
  }
  return out.slice(0, count + 4)
}
