'use client'

import { stop as stopPhysics } from '@/lib/physics/world'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { walkthroughEngine } from '@/lib/walkthrough/walkthrough-engine'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { perform } from './player'
import { bumpRun, makeStage } from './stage'
import { useLesson } from './store'
import type { Storyboard } from './storyboard'

async function playFrom(sb: Storyboard, pageId: string, from: number) {
  const myRun = bumpRun()
  narrator.stop()
  const s = useLesson.getState()
  s.set({ active: true, storyboard: sb, pageId, index: from, paused: false, pending: null, chosen: null, card: null })
  const result = await perform(sb, makeStage(sb, pageId, myRun), from)
  if (result === 'done' && useLesson.getState().storyboard === sb) useLesson.getState().set({ caption: 'That is the lesson. Replay it, or try the questions yourself.', pending: null })
}

export const startLesson = (sb: Storyboard, pageId: string) => playFrom(sb, pageId, 0)

/** Jump to a beat (previous/next/scrub). The player re-applies the scene that beat needs. */
export function seekLesson(index: number) {
  const { storyboard, pageId } = useLesson.getState()
  if (!storyboard || !pageId) return
  void playFrom(storyboard, pageId, Math.max(0, Math.min(storyboard.beats.length - 1, index)))
}

export const pauseLesson = () => { narrator.pause(); useLesson.getState().set({ paused: true }) }
export const resumeLesson = () => { narrator.resume(); useLesson.getState().set({ paused: false }) }

export function stopLesson() {
  bumpRun()
  narrator.stop()
  stopPhysics()
  useLesson.getState().set({ active: false, pending: null, card: null, caption: '', paused: false })
}

/** A fresh page for the film, next to the student's own — their work is never touched.
 *  A running product tour owns a scratch notebook and the active page; end it first, so the
 *  lesson lands in the student's notebook and the tour's cleanup cannot delete it. */
export function openLessonPage(title: string): string | null {
  if (useWalkthroughStore.getState().active) walkthroughEngine.stop()
  const s = useWorkspaceStore.getState()
  const parentId = s.activePageId ? s.nodes[s.activePageId]?.parentId : null
  return parentId ? s.addPageIn(parentId, `Lesson: ${title}`.slice(0, 80), 'board') : null
}
