'use client'

// An ASIDE: the student interrupts with "can you show me three resistors in parallel and teach me what
// happens?" and the teacher does exactly that, there and then — plans a short lesson on it, draws it on the
// board in new sections beneath the ones already taught, and talks through it. The lesson proper resumes
// afterwards (tutor.ts). Same director, runner and stage as a generated lesson, so what is drawn is a real
// simulation, measured, not a picture.

import { useLearner } from '@/lib/learning/store'
import { directLesson, planTopic } from './director'
import { makeLlm } from './llm'
import { PLAN_JSON_SCHEMA } from './plan'
import { perform } from './player'
import { makeRunner } from './runner'
import { bumpRun, makeStage } from './stage'
import { useLesson } from './store'

/** At most this many steps: it is an aside, not a second lesson. */
const ASIDE_STEPS = 3

/** Build and play the aside. Returns false when nothing could be drawn (the caller then just answers in words). */
export async function playAside(question: string, status: (message: string) => void): Promise<boolean> {
  const pageId = useLesson.getState().pageId
  if (!pageId) return false
  const level = useLearner.getState().prefs.level
  const llm = makeLlm()
  status('Working out how to show that…')
  const plan = await planTopic(llm, question, level, PLAN_JSON_SCHEMA)
  const { storyboard } = await directLesson(question, { ...plan, steps: plan.steps.slice(0, ASIDE_STEPS) }, { llm, runner: makeRunner(), level, onProgress: status, diagrams: true })
  if (!useLesson.getState().active) return false // the student closed the lesson while it was being drawn up
  const result = await perform(storyboard, makeStage(storyboard, pageId, bumpRun(), 0, { aside: true }), 0, { rebuild: false })
  return result === 'done' && storyboard.beats.some((b) => b.t === 'scene')
}
