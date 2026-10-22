'use client'

// "Teach me anything": build a film for a topic that has no authored lesson, in the
// background, with visible progress and a Cancel — then play it. The first film on a
// topic takes about a minute (plan + one scene per step + real simulator runs);
// replays come from the cache instantly.

import { toast } from 'sonner'
import { useLearner } from '@/lib/learning/store'
import { directLesson, NeedsClarification, planTopic, type Llm, type Runner } from './director'
import { makeLlm } from './llm'
import { makeRunner } from './runner'
import { useLessonCache } from './cache'
import { PLAN_JSON_SCHEMA } from './plan'
import { openLessonPage, startLesson } from './controller'
import { useLesson } from './store'
import { resolveRoute } from '@/lib/ai/transport'

export interface DirectorParts { llm: Llm; runner: Runner }
let parts: () => DirectorParts = () => ({ llm: makeLlm(), runner: makeRunner() })
/** Tests inject a scripted model and runner. */
export const setDirectorParts = (fn: () => DirectorParts) => { parts = fn }

let abort: AbortController | null = null
export function cancelPreparing() {
  abort?.abort()
  abort = null
  useLesson.getState().set({ preparing: null })
}

export async function generateAndPlay(topic: string): Promise<void> {
  const level = useLearner.getState().prefs.level
  const cached = useLessonCache.getState().get(topic, level)
  if (cached) {
    const pageId = openLessonPage(cached.title)
    if (pageId) void startLesson(cached, pageId)
    return
  }
  cancelPreparing()
  const ac = (abort = new AbortController())
  const set = (message: string) => useLesson.getState().set({ preparing: { topic, message } })
  set('Planning the lesson…')
  try {
    const { llm, runner } = parts()
    const plan = await planTopic(llm, topic, level, PLAN_JSON_SCHEMA, ac.signal)
    const { storyboard, warnings } = await directLesson(topic, plan, { llm, runner, level, signal: ac.signal, onProgress: set, diagrams: true })
    if (ac.signal.aborted) return
    useLessonCache.getState().put(topic, level, storyboard)
    useLesson.getState().set({ preparing: null })
    const pageId = openLessonPage(storyboard.title)
    if (!pageId) throw new Error('Open a notebook page first.')
    if (warnings.length) console.info('[lesson] left out:', warnings)
    void startLesson(storyboard, pageId)
  } catch (e) {
    if (ac.signal.aborted) return
    useLesson.getState().set({ preparing: null })
    if (e instanceof NeedsClarification) toast.message(e.message, { duration: 12_000 })
    else {
      const msg = e instanceof Error ? e.message : 'Could not build that lesson.'
      // A plan needs a capable model: the small on-device one cannot write it, and says nothing useful when it fails.
      const onDevice = /usable lesson plan/.test(msg) && resolveRoute().where === 'device'
      toast.error(onDevice ? `${msg} The on-device model is too small to plan a lesson — switch the assistant to Server for this.` : msg)
    }
  } finally {
    if (abort === ac) abort = null
  }
}
