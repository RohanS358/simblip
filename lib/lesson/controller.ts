'use client'

import { stop as stopPhysics } from '@/lib/physics/world'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { walkthroughEngine } from '@/lib/walkthrough/walkthrough-engine'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { useDocStore } from '@/lib/store/document'
import { prefetch } from '@/lib/tts/neural'
import { upcomingLines } from './lines'
import { perform } from './player'
import { bumpRun, makeStage } from './stage'
import { useLesson } from './store'
import { useTutor, cancelChoice } from './tutor-store'
import { START_PACE } from './tutor-core'
import { useTeacher } from '@/lib/teacher/store'
import type { Storyboard } from './storyboard'

async function playFrom(sb: Storyboard, pageId: string, from: number, rebuild = true) {
  const myRun = bumpRun()
  narrator.stop()
  const s = useLesson.getState()
  // Rebuilding from a beat: take down the lesson's own sections (the student's drawings stay) and
  // let catch-up lay them out again, so seeking never duplicates a section.
  if (rebuild) {
    const old = s.sections.flatMap((x) => x.ids)
    if (old.length && useDocStore.getState().pages[pageId]) useDocStore.getState().removeObjects(pageId, old)
    s.set({ sections: [] })
  }
  s.set({ active: true, storyboard: sb, pageId, index: from, paused: false, pending: null, chosen: null, card: null })
  const result = await perform(sb, makeStage(sb, pageId, myRun, from), from, { rebuild })
  if (result === 'done' && useLesson.getState().storyboard === sb) {
    useLesson.getState().set({ pending: null })
    useTeacher.getState().set({ mood: 'laughing', pose: 'celebrate' })
    setTimeout(() => useTeacher.getState().set({ mood: 'proud', pose: 'read' }), 3200)
  }
}

export const startLesson = (sb: Storyboard, pageId: string) => {
  useTutor.getState().set({ pace: START_PACE, missesInRow: 0, lastCheck: 0, resumeAt: null, ring: null, mode: 'idle' })
  useTeacher.getState().set({ mood: 'happy', pose: 'read', aim: null })
  return playFrom(sb, pageId, 0)
}

/** Carry on from `index` after the teacher answered a question: nothing on the board is rebuilt. */
export function continueLesson(index: number) {
  const { storyboard, pageId } = useLesson.getState()
  if (storyboard && pageId) void playFrom(storyboard, pageId, index, false)
}

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
  cancelChoice()
  useTutor.getState().set({ ring: null, spot: [], mode: 'idle', resumeAt: null })
  narrator.stop()
  stopPhysics()
  useLesson.getState().set({ active: false, pending: null, card: null, caption: '', paused: false, sections: [] })
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
