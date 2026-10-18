// The hint ladder (docs/ai-plans §6.3): never the bare answer first.
// The rung is code; the model only words the current rung.

export const RUNGS = ['restate', 'nudge', 'cue', 'partial', 'worked'] as const
export type Rung = 0 | 1 | 2 | 3 | 4

export const RUNG_BRIEF: Record<(typeof RUNGS)[number], string> = {
  restate: 'Restate the question in simpler words. Do not hint at the answer.',
  nudge: 'Point at where to look (a quantity, a part of the figure). Do not name the principle.',
  cue: 'Name the principle or law that applies. Do not do any working.',
  partial: 'Do only the first step of the working and leave the rest to the student.',
  worked: 'Give a full worked example of a SIMILAR problem with different numbers, then re-ask the original.',
}

/** Next rung for a question. Saturates at the top. */
export const nextRung = (current: number | undefined): Rung => (current === undefined ? 0 : (Math.min(4, current + 1) as Rung))
